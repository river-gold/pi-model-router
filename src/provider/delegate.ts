import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RouterProfile, RoutingDecision } from "../types";
import {
  parseCanonicalModelRef,
  formatModelRef,
  ROUTER_TIERS,
  resolveContextWindow,
  resolveDelegatedReasoning,
} from "../config";
import { truncateContext } from "../context";
import { modelWithAuthBaseUrl, streamDelegated } from "../stream";
import { chainKeyForRoute, normalizeFailedRef, isRecordablePreStreamError } from "../failureMemory";
import type { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export type DelegateParams = {
  registry: ExtensionContext["modelRegistry"];
  profile: RouterProfile;
  decision: RoutingDecision;
  routerModel: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  state: {
    failedByChain: Map<string, Set<string>>;
    lastDecision: RoutingDecision | undefined;
    accumulatedCost: number;
    lastExtensionContext: ExtensionContext | undefined;
  };
  withCommitMutex: <T>(fn: () => T | Promise<T>) => Promise<T>;
  stream: ReturnType<typeof createAssistantMessageEventStream>;
  recordDebugDecision: (d: RoutingDecision) => void;
};

export type DelegateResult = {
  success: boolean;
  costDelta: number;
  fallbackDecision?: RoutingDecision;
  lastError?: unknown;
};

// delegateToTierModels handles fallback loop, truncation, bufferedEvents etc.
export const delegateToTierModels = async (params: DelegateParams): Promise<DelegateResult> => {
  const { registry, profile, decision, routerModel, context, options, state, withCommitMutex, stream, recordDebugDecision } = params;

  let modelsToTry = [
    ...new Set(
      profile[decision.tier]?.models! ?? [
        formatModelRef(decision.targetProvider, decision.targetModelId, decision.thinking),
      ],
    ),
  ];
  const routeChainKey = chainKeyForRoute(decision.profile, decision.tier);
  const recordRouteFailure = (ref: string) => {
    const norm = normalizeFailedRef(ref);
    let s = state.failedByChain.get(routeChainKey);
    if (!s) {
      s = new Set<string>();
      state.failedByChain.set(routeChainKey, s);
    }
    s.add(norm);
  };
  const routeFailedSet = state.failedByChain.get(routeChainKey);
  const skippedDueToMemory: string[] = [];
  if (routeFailedSet && routeFailedSet.size > 0) {
    const beforeLen = modelsToTry.length;
    modelsToTry = modelsToTry.filter((ref) => {
      const norm = normalizeFailedRef(ref);
      if (routeFailedSet.has(norm)) {
        skippedDueToMemory.push(ref);
        return false;
      }
      return true;
    });
    if (modelsToTry.length === 0 && beforeLen > 0) {
      throw new Error(
        `All models in ${decision.tier} tier are marked failed this session (skipped: ${skippedDueToMemory.join(", ")}). Run /router reset-failures to retry.`,
      );
    }
  }

  let lastError: unknown;
  let success = false;
  let costDelta = 0;

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelRef = modelsToTry[i];
    const { provider: targetProvider, modelId: targetModelId, thinking: refThinking } = parseCanonicalModelRef(modelRef);
    const tryThinking = refThinking ?? decision.thinking;
    if (targetProvider === "router") continue;
    const targetModel = registry.find(targetProvider, targetModelId);
    if (!targetModel) {
      lastError = new Error(`Routed model not found: ${targetProvider}/${targetModelId}`);
      if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
      continue;
    }
    const auth = await registry.getApiKeyAndHeaders(targetModel);
    if (!auth.ok || !auth.apiKey) {
      lastError = new Error(
        auth.ok
          ? `No API key for routed model: ${targetProvider}/${targetModelId}`
          : `Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`,
      );
      if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
      continue;
    }
    const apiKey = auth.apiKey;
    const headers = auth.headers;
    const requestModel = modelWithAuthBaseUrl(targetModel, auth as { baseUrl?: string });
    if (options?.signal?.aborted) throw new Error("aborted");
    let contentReceivedForTry = false;
    let pendingCostDelta = 0;
    try {
      let effectiveContext = context;
      let targetLimit: number;
      {
        let tierForModel: import("../types").RouterTier | undefined;
        for (const t of ROUTER_TIERS) {
          const tc = profile[t];
          if (!tc) continue;
          if (tc.models!.includes(modelRef)) {
            tierForModel = t;
            break;
          }
        }
        if (tierForModel) {
          targetLimit = resolveContextWindow(tierForModel, profile, registry);
        } else {
          const found = registry.find(targetProvider, targetModelId);
          targetLimit = found?.contextWindow ?? resolveContextWindow(decision.tier, profile, registry);
        }
      }
      if (targetLimit < routerModel.contextWindow!) {
        effectiveContext = truncateContext(context, targetLimit);
      }
      const delegatedReasoning = resolveDelegatedReasoning(targetModel, tryThinking) as
        | SimpleStreamOptions["reasoning"]
        | undefined;
      try {
        if (state.lastExtensionContext) {
          if (delegatedReasoning) {
            state.lastExtensionContext.ui.setHiddenThinkingLabel?.(
              `Thinking (${targetProvider}/${targetModelId})...`,
            );
          } else {
            state.lastExtensionContext.ui.setHiddenThinkingLabel?.();
          }
        }
      } catch {
        // stale
      }
      const { reasoning: _piReasoning, ...delegationOptions } = (options ?? {}) as SimpleStreamOptions;
      const delegatedStream = streamDelegated(registry, requestModel, effectiveContext, {
        ...delegationOptions,
        apiKey,
        headers,
        ...(delegatedReasoning ? { reasoning: delegatedReasoning } : {}),
      });
      const bufferedEvents: unknown[] = [];
      let gotDone = false;
      let gotError = false;
      let bufferedErrorMessage: string | undefined;
      if (!delegatedStream) throw new Error("No delegated stream available");
      for await (const event of delegatedStream) {
        if (options?.signal?.aborted) throw new Error("aborted");
        bufferedEvents.push(event);
        if ((event as { type: string }).type === "done") {
          gotDone = true;
          const cost =
            (
              event as {
                message?: { usage?: { cost?: { total?: number } } };
              }
            ).message?.usage?.cost?.total ?? 0;
          pendingCostDelta = cost;
        }
        if ((event as { type: string }).type === "error") {
          gotError = true;
          const errObj = (event as { error?: unknown }).error;
          if (
            errObj &&
            typeof errObj === "object" &&
            "errorMessage" in errObj &&
            typeof (errObj as { errorMessage?: unknown }).errorMessage === "string"
          ) {
            bufferedErrorMessage = (errObj as { errorMessage: string }).errorMessage;
          }
        }
        const isContent =
          (event as { type: string }).type === "text_delta" ||
          (event as { type: string }).type === "thinking_delta" ||
          (event as { type: string }).type === "toolcall_delta" ||
          (event as { type: string }).type === "toolcall_end";
        if (isContent) contentReceivedForTry = true;
      }
      if (gotDone) {
        for (const ev of bufferedEvents) stream.push(ev as never);
        success = true;
        costDelta = pendingCostDelta;
        if (pendingCostDelta) {
          await withCommitMutex(async () => {
            state.accumulatedCost += pendingCostDelta;
          });
        }
        if (i > 0) {
          const { provider: fp, modelId: fid, thinking: ft } = parseCanonicalModelRef(modelRef);
          decision.isFallback = true;
          decision.targetProvider = fp;
          decision.targetModelId = fid;
          decision.targetLabel = formatModelRef(fp, fid);
          decision.thinking = ft ?? decision.thinking;
          await withCommitMutex(async () => {
            if (state.lastDecision === decision || state.lastDecision?.profile === decision.profile) {
              state.lastDecision = { ...decision };
            }
          });
          recordDebugDecision(decision);
        }
        break;
      }
      if (gotError) {
        if (contentReceivedForTry) {
          for (const ev of bufferedEvents) stream.push(ev as never);
          throw new Error(`NON_RETRYABLE: ${bufferedErrorMessage || "Model failed after sending content."}`);
        }
        throw new Error(bufferedErrorMessage || "Model failed before sending content.");
      }
      throw new Error("Model stream ended without terminal event.");
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("NON_RETRYABLE:")) {
        lastError = new Error(err.message.slice("NON_RETRYABLE: ".length));
        break;
      }
      if (contentReceivedForTry) {
        lastError = err;
        break;
      }
      lastError = err;
      if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
    }
  }
  return { success, costDelta, fallbackDecision: decision, lastError };
};
