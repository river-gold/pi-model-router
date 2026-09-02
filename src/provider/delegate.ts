import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RoutingDecision } from "../types";
import { parseCanonicalModelRef, formatModelRef, ROUTER_TIERS, resolveContextWindow, resolveDelegatedReasoning } from "../config";
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

export type DelegateResult = { success: boolean; costDelta: number; fallbackDecision?: RoutingDecision; lastError?: unknown };

export const getInitialModelsToTry = (profile: RouterProfile, decision: RoutingDecision): string[] => {
  const tierModels = profile[decision.tier]?.models;
  if (!tierModels?.length) return [formatModelRef(decision.targetProvider, decision.targetModelId, decision.thinking)];
  return [...new Set(tierModels)];
};

export const filterByFailureMemory = (
  modelsToTry: string[],
  failedSet: Set<string> | undefined,
): { filtered: string[]; skipped: string[]; allFiltered: boolean } => {
  if (!failedSet?.size) return { filtered: modelsToTry, skipped: [], allFiltered: false };
  const skipped: string[] = [];
  const filtered = modelsToTry.filter((ref) => {
    if (failedSet.has(normalizeFailedRef(ref))) {
      skipped.push(ref);
      return false;
    }
    return true;
  });
  return { filtered, skipped, allFiltered: filtered.length === 0 && modelsToTry.length > 0 };
};

export const createRecordFailure = (state: DelegateParams["state"], routeChainKey: string) => (ref: string): void => {
  const s = state.failedByChain.get(routeChainKey) ?? new Set<string>();
  if (!state.failedByChain.has(routeChainKey)) state.failedByChain.set(routeChainKey, s);
  s.add(normalizeFailedRef(ref));
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
    if (tc?.models?.includes(modelRef)) return resolveContextWindow(t, profile, registry);
  }
  const found = registry.find(targetProvider, targetModelId);
  return found?.contextWindow ?? resolveContextWindow(decision.tier, profile, registry);
};

export const buildEffectiveContext = (context: Context, targetLimit: number, routerModel: Model<Api>): Context =>
  targetLimit < (routerModel.contextWindow ?? Infinity) ? truncateContext(context, targetLimit) : context;

export const isContentEvent = (type: string): boolean =>
  type === "text_delta" || type === "thinking_delta" || type === "toolcall_delta" || type === "toolcall_end";

export const collectBufferedResult = (
  bufferedEvents: unknown[],
): { gotDone: boolean; gotError: boolean; bufferedErrorMessage?: string; pendingCostDelta: number; contentReceived: boolean } => {
  let gotDone = false;
  let gotError = false;
  let bufferedErrorMessage: string | undefined;
  let pendingCostDelta = 0;
  let contentReceived = false;
  for (const event of bufferedEvents) {
    const type = (event as { type: string }).type;
    if (type === "done") {
      gotDone = true;
      pendingCostDelta = (event as { message?: { usage?: { cost?: { total?: number } } } }).message?.usage?.cost?.total ?? 0;
    } else if (type === "error") {
      gotError = true;
      const errObj = (event as { error?: unknown }).error as { errorMessage?: unknown } | undefined;
      if (typeof errObj?.errorMessage === "string") bufferedErrorMessage = errObj.errorMessage;
    }
    if (isContentEvent(type)) contentReceived = true;
  }
  return { gotDone, gotError, bufferedErrorMessage, pendingCostDelta, contentReceived };
};

export const resolveAuthError = (
  auth: { ok: boolean; apiKey?: string; error?: string },
  targetProvider: string,
  targetModelId: string,
): Error => (!auth.ok ? new Error(`Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`) : new Error(`No API key for routed model: ${targetProvider}/${targetModelId}`));

export const shouldSkipRouterModel = (provider: string): boolean => provider === "router";

export const buildFallbackDecision = (decision: RoutingDecision, modelRef: string): void => {
  const { provider, modelId, thinking } = parseCanonicalModelRef(modelRef);
  Object.assign(decision, {
    isFallback: true,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    thinking: thinking ?? decision.thinking,
  });
};

type AttemptResult =
  | { status: "success"; costDelta: number }
  | { status: "retry"; error: Error }
  | { status: "nonRetryable"; error: Error }
  | { status: "skip" };

export const attemptSingleModel = async (
  modelRef: string,
  index: number,
  params: DelegateParams,
  recordRouteFailure: (ref: string) => void,
): Promise<AttemptResult> => {
  const { registry, profile, decision, routerModel, context, options, state, withCommitMutex, stream, recordDebugDecision } = params;
  const { provider, modelId, thinking } = parseCanonicalModelRef(modelRef);
  const tryThinking = thinking ?? decision.thinking;
  if (shouldSkipRouterModel(provider)) return { status: "skip" };
  const targetModel = registry.find(provider, modelId);
  if (!targetModel) {
    const err = new Error(`Routed model not found: ${provider}/${modelId}`);
    if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
    return { status: "retry", error: err };
  }
  const auth = await registry.getApiKeyAndHeaders(targetModel);
  if (!auth.ok || !auth.apiKey) {
    const err = resolveAuthError(auth as { ok: boolean; apiKey?: string; error?: string }, provider, modelId);
    if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
    return { status: "retry", error: err };
  }
  if (options?.signal?.aborted) return { status: "nonRetryable", error: new Error("aborted") };
  const targetLimit = resolveTargetLimit(profile, decision, modelRef, registry, provider, modelId);
  const effectiveContext = buildEffectiveContext(context, targetLimit, routerModel);
  const delegatedReasoning = resolveDelegatedReasoning(targetModel, tryThinking) as SimpleStreamOptions["reasoning"] | undefined;
  try {
    const label = `Thinking (${provider}/${modelId})...`;
    if (delegatedReasoning) state.lastExtensionContext?.ui.setHiddenThinkingLabel?.(label);
    else state.lastExtensionContext?.ui.setHiddenThinkingLabel?.();
  } catch {}
  const { reasoning: _piReasoning, ...delegationOptions } = (options ?? {}) as SimpleStreamOptions;
  const delegatedStream = streamDelegated(registry, modelWithAuthBaseUrl(targetModel, auth as { baseUrl?: string }), effectiveContext, {
    ...delegationOptions,
    apiKey: auth.apiKey,
    headers: auth.headers,
    ...(delegatedReasoning ? { reasoning: delegatedReasoning } : {}),
  });
  if (!delegatedStream) {
    const err = new Error("No delegated stream available");
    if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
    return { status: "retry", error: err };
  }
  const bufferedEvents: unknown[] = [];
  let contentReceivedForTry = false;
  for await (const event of delegatedStream) {
    if (options?.signal?.aborted) return { status: "nonRetryable", error: new Error("aborted") };
    bufferedEvents.push(event);
    if (isContentEvent((event as { type: string }).type)) contentReceivedForTry = true;
  }
  const collected = collectBufferedResult(bufferedEvents);
  contentReceivedForTry = collected.contentReceived || contentReceivedForTry;
  if (collected.gotDone) {
    for (const ev of bufferedEvents) stream.push(ev as never);
    if (collected.pendingCostDelta) await withCommitMutex(async () => { state.accumulatedCost += collected.pendingCostDelta; });
    if (index > 0) {
      buildFallbackDecision(decision, modelRef);
      await withCommitMutex(async () => {
        if (state.lastDecision === decision || state.lastDecision?.profile === decision.profile) state.lastDecision = { ...decision };
      });
      recordDebugDecision(decision);
    }
    return { status: "success", costDelta: collected.pendingCostDelta };
  }
  if (collected.gotError) {
    if (contentReceivedForTry) {
      for (const ev of bufferedEvents) stream.push(ev as never);
      return { status: "nonRetryable", error: new Error(`NON_RETRYABLE: ${collected.bufferedErrorMessage || "Model failed after sending content."}`) };
    }
    const err = new Error(collected.bufferedErrorMessage || "Model failed before sending content.");
    if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
    return { status: "retry", error: err };
  }
  const err = new Error("Model stream ended without terminal event.");
  if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
  return { status: "retry", error: err };
};

export const delegateToTierModels = async (params: DelegateParams): Promise<DelegateResult> => {
  const { profile, decision, state } = params;
  const initialModels = getInitialModelsToTry(profile, decision);
  const routeChainKey = chainKeyForRoute(decision.profile, decision.tier);
  const recordRouteFailure = createRecordFailure(state, routeChainKey);
  const { filtered: modelsToTry, allFiltered, skipped: skippedDueToMemory } = filterByFailureMemory(initialModels, state.failedByChain.get(routeChainKey));
  if (allFiltered) throw new Error(`All models in ${decision.tier} tier are marked failed this session (skipped: ${skippedDueToMemory.join(", ")}). Run /router reset-failures to retry.`);
  let lastError: unknown;
  let success = false;
  let costDelta = 0;
  for (let i = 0; i < modelsToTry.length; i++) {
    const result = await attemptSingleModel(modelsToTry[i], i, params, recordRouteFailure);
    if (result.status === "skip") continue;
    if (result.status === "success") {
      success = true;
      costDelta = result.costDelta;
      break;
    }
    if (result.status === "nonRetryable") {
      const msg = result.error.message;
      lastError = msg.startsWith("NON_RETRYABLE:") ? new Error(msg.slice("NON_RETRYABLE: ".length)) : result.error;
      break;
    }
    lastError = result.error;
  }
  return { success, costDelta, fallbackDecision: decision, lastError };
};
