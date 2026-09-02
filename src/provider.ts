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
import type { RouterConfig, RouterProfile, RoutingDecision, RouterTier } from "./types";
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
import { decideInitialDecision } from "./provider/routing";
import { runClassifierBranch } from "./provider/classifierBranch";
import { delegateToTierModels } from "./provider/delegate";
import { validateProviderState } from "./provider/validation";
import { createCommitMutex, type RouterProviderState } from "./provider/state";
import { streamDelegated, modelWithAuthBaseUrl } from "./stream";
import { chainKeyForRoute, isRecordablePreStreamError } from "./failureMemory";

export { streamDelegated, createAssistantMessageEventStream, modelWithAuthBaseUrl, chainKeyForRoute, isRecordablePreStreamError };

const createErrorMessage = (model: Model<Api>, message: string): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "error",
  errorMessage: message,
  timestamp: Date.now(),
});

export const normalizeDelegateError = (lastError: unknown): Error =>
  lastError instanceof Error ? lastError : new Error(typeof lastError === "string" ? lastError : "Failed to delegate to any model in the chain.");

const pushStreamError = (stream: AssistantMessageEventStream, model: Model<Api>, error: unknown): void => {
  if (error instanceof Error && error.message === "aborted") {
    stream.push({ type: "done", reason: "stop", message: createErrorMessage(model, "aborted") });
    stream.end();
    return;
  }
  if (error instanceof Error && error.message.includes("stale")) {
    stream.push({ type: "done", reason: "stop", message: createErrorMessage(model, "") });
  } else {
    stream.push({ type: "error", reason: "error", error: createErrorMessage(model, error instanceof Error ? error.message : String(error)) });
  }
  stream.end();
};

const safeUpdateStatus = (state: RouterProviderState, actions: { updateStatus: (ctx: ExtensionContext) => void }): void => {
  try {
    if (state.lastExtensionContext) actions.updateStatus(state.lastExtensionContext);
  } catch {
    // stale
  }
};

const safePersist = (actions: { persistState: () => void }): void => {
  try {
    actions.persistState();
  } catch {
    // stale
  }
};

const applyClassifierIfNeeded = async (
  profile: import("./types").RouterProfile,
  decision: RoutingDecision,
  modelId: string,
  registry: ExtensionContext["modelRegistry"],
  state: RouterProviderState,
  context: Context,
  signal: AbortSignal | undefined,
  isSingleTier: boolean,
  isToolLoopNow: boolean,
  thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>,
  classifierSource: string,
): Promise<RoutingDecision> => {
  if (isSingleTier || isToolLoopNow || thinkingLevel !== "off") return decision;
  const effectiveHistorySize = state.currentConfig.historySize ?? 0;
  const failedSet = state.failedByChain.get(CLASSIFIER_CHAIN_KEY) ?? new Set<string>();
  const { result } = await runClassifierBranch(registry, profile, state, context, signal, effectiveHistorySize, failedSet, classifierSource);
  const tier = resolveAvailableTier(profile, result!.tier);
  let reasoning = `Classifier: ${result!.reasoning}`;
  if (tier !== result!.tier) reasoning = `Resolved from ${result!.tier} to ${tier} tier (${result!.tier} tier is not configured). Original: ${reasoning}`;
  return buildRoutingDecision(modelId, profile, tier, reasoning, true);
};

export const registerRouterProvider = (
  pi: ExtensionAPI,
  state: RouterProviderState,
  actions: { persistState: () => void; recordDebugDecision: (d: RoutingDecision) => void; updateStatus: (ctx: ExtensionContext) => void },
) => {
  const { withCommitMutex } = createCommitMutex();
  const profileList = profileNames(state.currentConfig);
  const modelDefinitions = profileList.map((name) => {
    const profile = state.currentConfig.profiles[name];
    let maxContextWindow = DEFAULT_CONTEXT_WINDOW;
    let maxMaxTokens = DEFAULT_MAX_TOKENS;
    for (const tier of ROUTER_TIERS.filter((t) => profile[t])) {
      const cw = resolveContextWindow(tier, profile, state.currentModelRegistry);
      const mot = resolveMaxTokens(tier, profile, state.currentModelRegistry);
      if (cw > maxContextWindow) maxContextWindow = cw;
      if (mot > maxMaxTokens) maxMaxTokens = mot;
    }
    return {
      id: name,
      name: `Router ${name}`,
      reasoning: true,
      thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: maxContextWindow,
      maxTokens: maxMaxTokens,
    };
  });
  const modelsKey = modelDefinitions.map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`).join(",");
  if (state.lastRegisteredModels === modelsKey) return;
  pi.registerProvider("router", {
    baseUrl: "router://local",
    apiKey: "pi-model-router",
    api: "router-local-api",
    models: modelDefinitions,
    streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
      const stream = createAssistantMessageEventStream();
      (async () => {
        try {
          const registry: ExtensionContext["modelRegistry"] | undefined = state.currentModelRegistry;
          const profile: RouterProfile | undefined = state.currentConfig.profiles[model.id];
          // @ts-ignore TS2775 non-null assertion requires explicit type, already provided
          validateProviderState(registry as ExtensionContext["modelRegistry"] | undefined, profile, model.id);
          const snap = state.lastDecision;
          await withCommitMutex(async () => { state.selectedProfile = model.id; state.routerEnabled = true; });
          if (options?.signal?.aborted) throw new Error("aborted");
          const isToolLoop = context.messages[context.messages.length - 1]?.role === "toolResult" && snap?.profile === model.id && snap !== undefined;
          let decision = decideInitialDecision({
            profileName: model.id, profile: profile as RouterProfile, context, snapshotLastDecision: snap,
            thinkingLevel: pi.getThinkingLevel(), isToolLoop,
            singleTier: ROUTER_TIERS.find((t) => (profile as RouterProfile)[t]) as RouterTier | undefined,
            validTierCount: ROUTER_TIERS.filter((t) => (profile as RouterProfile)[t]).length,
          });
          const { source } = resolveEffectiveClassifier(profile as RouterProfile, state.currentConfig.classifierModels);
          const isSingleTier = ROUTER_TIERS.filter((t) => (profile as RouterProfile)[t]).length === 1;
          const isToolLoopNow = context.messages[context.messages.length - 1]?.role === "toolResult" && snap?.profile === model.id;
          decision = await applyClassifierIfNeeded(profile as RouterProfile, decision, model.id, registry as ExtensionContext["modelRegistry"], state, context, options?.signal, isSingleTier, isToolLoopNow, pi.getThinkingLevel(), source);
          await withCommitMutex(async () => { state.lastDecision = decision; });
          actions.recordDebugDecision(decision);
          safeUpdateStatus(state, actions);
          const res = await delegateToTierModels({ registry: registry as ExtensionContext["modelRegistry"], profile: profile as RouterProfile, decision, routerModel: model, context, options, state, withCommitMutex, stream, recordDebugDecision: actions.recordDebugDecision });
          if (!res.success) throw normalizeDelegateError(res.lastError);
          stream.end();
        } catch (error) {
          pushStreamError(stream, model, error);
        } finally {
          safePersist(actions);
        }
      })();
      return stream;
    },
  });
  state.lastRegisteredModels = modelsKey;
};
