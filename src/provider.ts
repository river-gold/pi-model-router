/* oxlint-disable */
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RoutingDecision, RouterTier } from "./types";
import {
  profileNames,
  ROUTER_TIERS,
  resolveContextWindow,
  resolveMaxTokens,
  resolveEffectiveClassifier,
} from "./config";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./constants";
import { buildRoutingDecision, resolveAvailableTier } from "./routing";
import { CLASSIFIER_CHAIN_KEY } from "./failureMemory";
import { resolveRoutingDecision } from "./provider/routingDecision";
import { runClassifierBranch } from "./provider/classifierBranch";
import { delegateToTierModels } from "./provider/delegate";
import { streamDelegated, modelWithAuthBaseUrl } from "./stream";
import { chainKeyForRoute, isRecordablePreStreamError } from "./failureMemory";

export { streamDelegated, createAssistantMessageEventStream, modelWithAuthBaseUrl, chainKeyForRoute, isRecordablePreStreamError };

const createErrorMessage = (model: Model<Api>, message: string): AssistantMessage => {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
  };
};

export const registerRouterProvider = (
  pi: ExtensionAPI,
  state: {
    lastRegisteredModels: string;
    readonly currentConfig: RouterConfig;
    readonly currentModelRegistry: ExtensionContext["modelRegistry"] | undefined;
    readonly lastExtensionContext: ExtensionContext | undefined;
    selectedProfile: string | undefined;
    routerEnabled: boolean;
    lastDecision: RoutingDecision | undefined;
    accumulatedCost: number;
    readonly failedByChain: Map<string, Set<string>>;
  },
  actions: {
    persistState: () => void;
    recordDebugDecision: (decision: RoutingDecision) => void;
    updateStatus: (ctx: ExtensionContext) => void;
  },
) => {
  let commitMutex: Promise<void> = Promise.resolve();
  const withCommitMutex = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const prev = commitMutex;
    let release!: () => void;
    commitMutex = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const profileList = profileNames(state.currentConfig);
  const modelDefinitions = profileList.map((name) => {
    const profile = state.currentConfig.profiles[name];
    let maxContextWindow = DEFAULT_CONTEXT_WINDOW;
    let maxMaxTokens = DEFAULT_MAX_TOKENS;
    for (const tier of ROUTER_TIERS) {
      if (!profile[tier]) continue;
      const cw = resolveContextWindow(tier, profile, state.currentModelRegistry);
      const mot = resolveMaxTokens(tier, profile, state.currentModelRegistry);
      if (cw > maxContextWindow) maxContextWindow = cw;
      if (mot > maxMaxTokens) maxMaxTokens = mot;
    }
    return {
      id: name,
      name: `Router ${name}`,
      reasoning: true,
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: maxContextWindow,
      maxTokens: maxMaxTokens,
    };
  });
  const modelsKey = modelDefinitions
    .map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`)
    .join(",");
  if (state.lastRegisteredModels === modelsKey) return;
  pi.registerProvider("router", {
    baseUrl: "router://local",
    apiKey: "pi-model-router",
    api: "router-local-api",
    models: modelDefinitions,
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const stream = createAssistantMessageEventStream();
      (async () => {
        try {
          const registry = state.currentModelRegistry;
          if (!registry) throw new Error("Router provider not initialized. session_start may not have fired.");
          const profile = state.currentConfig.profiles[model.id];
          if (!profile) throw new Error(`Unknown router profile: ${model.id}`);
          const snapshotLastDecision = state.lastDecision;
          await withCommitMutex(async () => {
            state.selectedProfile = model.id;
            state.routerEnabled = true;
          });
          if (options?.signal?.aborted) throw new Error("aborted");
          const lastMessageForLoop = context.messages[context.messages.length - 1];
          const isToolLoop =
            lastMessageForLoop?.role === "toolResult" &&
            snapshotLastDecision?.profile === model.id &&
            snapshotLastDecision !== undefined;
          const singleTier = ROUTER_TIERS.find((t) => profile[t]) as RouterTier | undefined;
          const validTierCount = ROUTER_TIERS.filter((t) => profile[t]).length;
          const thinkingLevel = pi.getThinkingLevel();
          let decision = resolveRoutingDecision({
            profileName: model.id,
            profile,
            context,
            snapshotLastDecision,
            thinkingLevel,
            isToolLoop,
            singleTier,
            validTierCount,
          });
          const { source: classifierSource } = resolveEffectiveClassifier(
            profile,
            state.currentConfig.classifierModels,
          );
          const isSingleTier = validTierCount === 1 && singleTier !== undefined;
          const shouldSkipClassifier = isToolLoop;
          if (!isSingleTier && !shouldSkipClassifier && thinkingLevel === "off") {
            const effectiveHistorySize = state.currentConfig.historySize ?? 0;
            const classifierFailedSet = state.failedByChain.get(CLASSIFIER_CHAIN_KEY) ?? new Set<string>();
            const { result: classifierResult } = await runClassifierBranch(
              registry,
              profile,
              state,
              context,
              options?.signal,
              effectiveHistorySize,
              classifierFailedSet,
              classifierSource,
            );
            if (classifierResult) {
              const preferred = classifierResult.tier;
              const tier = resolveAvailableTier(profile, preferred);
              let reasoning = `Classifier: ${classifierResult.reasoning}`;
              if (tier !== preferred) {
                reasoning = `Resolved from ${preferred} to ${tier} tier (${preferred} tier is not configured). Original: ${reasoning}`;
              }
              decision = buildRoutingDecision(model.id, profile, tier, reasoning, true);
            }
          }
          await withCommitMutex(async () => {
            state.lastDecision = decision;
          });
          actions.recordDebugDecision(decision);
          try {
            if (state.lastExtensionContext) actions.updateStatus(state.lastExtensionContext);
          } catch {
            // stale
          }
          const delegateResult = await delegateToTierModels({
            registry,
            profile,
            decision,
            routerModel: model,
            context,
            options,
            state,
            withCommitMutex,
            stream,
            recordDebugDecision: actions.recordDebugDecision,
          });
          if (!delegateResult.success) {
            throw delegateResult.lastError instanceof Error
              ? delegateResult.lastError
              : new Error(typeof delegateResult.lastError === "string" ? delegateResult.lastError : "Failed to delegate to any model in the chain.");
          }
          stream.end();
        } catch (error) {
          const isAborted = error instanceof Error && error.message === "aborted";
          if (isAborted) {
            stream.push({ type: "done", reason: "stop", message: createErrorMessage(model, "aborted") });
            stream.end();
            return;
          }
          const isStaleCtx = error instanceof Error && error.message.includes("stale");
          if (isStaleCtx) {
            stream.push({ type: "done", reason: "stop", message: createErrorMessage(model, "") });
          } else {
            stream.push({
              type: "error",
              reason: "error",
              error: createErrorMessage(model, error instanceof Error ? error.message : String(error)),
            });
          }
          stream.end();
        } finally {
          try {
            actions.persistState();
          } catch {
            // stale
          }
        }
      })();
      return stream;
    },
  });
  state.lastRegisteredModels = modelsKey;
};
