import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RoutingDecision } from "../types";
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

export const getInitialModelsToTry = (
  profile: RouterProfile,
  decision: RoutingDecision,
): string[] => {
  const tierModels = profile[decision.tier]?.models;
  if (tierModels && tierModels.length > 0) return [...new Set(tierModels)];
  return [formatModelRef(decision.targetProvider, decision.targetModelId, decision.thinking)];
};

export const filterByFailureMemory = (
  modelsToTry: string[],
  failedSet: Set<string> | undefined,
): { filtered: string[]; skipped: string[]; allFiltered: boolean } => {
  if (!failedSet || failedSet.size === 0) return { filtered: modelsToTry, skipped: [], allFiltered: false };
  const skipped: string[] = [];
  const filtered = modelsToTry.filter((ref) => {
    const norm = normalizeFailedRef(ref);
    if (failedSet.has(norm)) {
      skipped.push(ref);
      return false;
    }
    return true;
  });
  return { filtered, skipped, allFiltered: filtered.length === 0 && modelsToTry.length > 0 };
};

export const createRecordFailure = (
  state: DelegateParams["state"],
  routeChainKey: string,
) => {
  return (ref: string): void => {
    const norm = normalizeFailedRef(ref);
    let s = state.failedByChain.get(routeChainKey);
    if (!s) {
      s = new Set<string>();
      state.failedByChain.set(routeChainKey, s);
    }
    s.add(norm);
  };
};

export const resolveTargetLimit = (
  profile: RouterProfile,
  decision: RoutingDecision,
  modelRef: string,
  registry: ExtensionContext["modelRegistry"],
  targetProvider: string,
  targetModelId: string,
): number => {
  for (const t of ROUTER_TIERS) {
    const tc = profile[t];
    if (!tc) continue;
    if (tc.models!.includes(modelRef)) return resolveContextWindow(t, profile, registry);
  }
  const found = registry.find(targetProvider, targetModelId);
  return found?.contextWindow ?? resolveContextWindow(decision.tier, profile, registry);
};

export const buildEffectiveContext = (
  context: Context,
  targetLimit: number,
  routerModel: Model<Api>,
): Context => {
  if (targetLimit < routerModel.contextWindow!) return truncateContext(context, targetLimit);
  return context;
};

export const isContentEvent = (type: string): boolean =>
  type === "text_delta" ||
  type === "thinking_delta" ||
  type === "toolcall_delta" ||
  type === "toolcall_end";

export const collectBufferedResult = (
  bufferedEvents: unknown[],
): {
  gotDone: boolean;
  gotError: boolean;
  bufferedErrorMessage?: string;
  pendingCostDelta: number;
  contentReceived: boolean;
} => {
  let gotDone = false;
  let gotError = false;
  let bufferedErrorMessage: string | undefined;
  let pendingCostDelta = 0;
  let contentReceived = false;
  for (const event of bufferedEvents) {
    const type = (event as { type: string }).type;
    if (type === "done") {
      gotDone = true;
      const cost =
        (event as { message?: { usage?: { cost?: { total?: number } } } }).message?.usage?.cost?.total ?? 0;
      pendingCostDelta = cost;
    }
    if (type === "error") {
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
    if (isContentEvent(type)) contentReceived = true;
  }
  return { gotDone, gotError, bufferedErrorMessage, pendingCostDelta, contentReceived };
};

export const resolveAuthError = (
  auth: { ok: boolean; apiKey?: string; error?: string },
  targetProvider: string,
  targetModelId: string,
): Error => {
  if (!auth.ok) return new Error(`Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`);
  return new Error(`No API key for routed model: ${targetProvider}/${targetModelId}`);
};

export const shouldSkipRouterModel = (provider: string): boolean => provider === "router";

export const buildFallbackDecision = (
  decision: RoutingDecision,
  modelRef: string,
): void => {
  const { provider: fp, modelId: fid, thinking: ft } = parseCanonicalModelRef(modelRef);
  decision.isFallback = true;
  decision.targetProvider = fp;
  decision.targetModelId = fid;
  decision.targetLabel = formatModelRef(fp, fid);
  decision.thinking = ft ?? decision.thinking;
};

export const delegateToTierModels = async (params: DelegateParams): Promise<DelegateResult> => {
  const { registry, profile, decision, routerModel, context, options, state, withCommitMutex, stream, recordDebugDecision } =
    params;

  const initialModels = getInitialModelsToTry(profile, decision);
  const routeChainKey = chainKeyForRoute(decision.profile, decision.tier);
  const recordRouteFailure = createRecordFailure(state, routeChainKey);
  const routeFailedSet = state.failedByChain.get(routeChainKey);
  const { filtered: modelsToTry, skipped: skippedDueToMemory, allFiltered } = filterByFailureMemory(
    initialModels,
    routeFailedSet,
  );
  if (allFiltered) {
    throw new Error(
      `All models in ${decision.tier} tier are marked failed this session (skipped: ${skippedDueToMemory.join(", ")}). Run /router reset-failures to retry.`,
    );
  }

  let lastError: unknown;
  let success = false;
  let costDelta = 0;

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelRef = modelsToTry[i];
    const { provider: targetProvider, modelId: targetModelId, thinking: refThinking } =
      parseCanonicalModelRef(modelRef);
    const tryThinking = refThinking ?? decision.thinking;
    if (shouldSkipRouterModel(targetProvider)) continue;

    const targetModel = registry.find(targetProvider, targetModelId);
    if (!targetModel) {
      lastError = new Error(`Routed model not found: ${targetProvider}/${targetModelId}`);
      if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
      continue;
    }

    const auth = await registry.getApiKeyAndHeaders(targetModel);
    if (!auth.ok || !auth.apiKey) {
      lastError = resolveAuthError(auth as { ok: boolean; apiKey?: string; error?: string }, targetProvider, targetModelId);
      if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
      continue;
    }

    if (options?.signal?.aborted) throw new Error("aborted");

    const targetLimit = resolveTargetLimit(profile, decision, modelRef, registry, targetProvider, targetModelId);
    const effectiveContext = buildEffectiveContext(context, targetLimit, routerModel);
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
    const delegatedStream = streamDelegated(registry, modelWithAuthBaseUrl(targetModel, auth as { baseUrl?: string }), effectiveContext, {
      ...delegationOptions,
      apiKey: auth.apiKey,
      headers: auth.headers,
      ...(delegatedReasoning ? { reasoning: delegatedReasoning } : {}),
    });

    if (!delegatedStream) {
      lastError = new Error("No delegated stream available");
      if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
      continue;
    }

    const bufferedEvents: unknown[] = [];
    let contentReceivedForTry = false;

    for await (const event of delegatedStream) {
      if (options?.signal?.aborted) throw new Error("aborted");
      bufferedEvents.push(event);
      if (isContentEvent((event as { type: string }).type)) contentReceivedForTry = true;
    }

    const collected = collectBufferedResult(bufferedEvents);
    contentReceivedForTry = collected.contentReceived || contentReceivedForTry;

    if (collected.gotDone) {
      for (const ev of bufferedEvents) stream.push(ev as never);
      success = true;
      costDelta = collected.pendingCostDelta;
      if (collected.pendingCostDelta) {
        await withCommitMutex(async () => {
          state.accumulatedCost += collected.pendingCostDelta;
        });
      }
      if (i > 0) {
        buildFallbackDecision(decision, modelRef);
        await withCommitMutex(async () => {
          if (state.lastDecision === decision || state.lastDecision?.profile === decision.profile) {
            state.lastDecision = { ...decision };
          }
        });
        recordDebugDecision(decision);
      }
      break;
    }

    if (collected.gotError) {
      if (contentReceivedForTry) {
        for (const ev of bufferedEvents) stream.push(ev as never);
        lastError = new Error(`NON_RETRYABLE: ${collected.bufferedErrorMessage || "Model failed after sending content."}`);
        break;
      }
      lastError = new Error(collected.bufferedErrorMessage || "Model failed before sending content.");
      if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
      continue;
    }

    lastError = new Error("Model stream ended without terminal event.");
    if (isRecordablePreStreamError(lastError)) recordRouteFailure(modelRef);
  }

  return { success, costDelta, fallbackDecision: decision, lastError };
};
