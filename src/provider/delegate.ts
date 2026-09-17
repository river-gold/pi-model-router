import type {
  Api,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Router, RoutingDecision } from "../types";
import { dereferenceTier, isObjectRecord } from "../config";
import {
  parseCanonicalModelRef,
  formatModelRef,
  ROUTER_TIERS,
  resolveContextWindow,
  resolveContextWindowLive,
  resolveDelegatedReasoning,
} from "../config";
import { truncateContext } from "../context";
import { modelWithAuthBaseUrl, streamDelegated } from "../stream";
import { mergeDelegatedHeaders } from "./attribution";
import {
  chainKeyForRoute,
  failedRefsForChain,
  normalizeFailedRef,
  rememberPreStreamFailure,
} from "../failureMemory";
import type { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export type DelegateParams = {
  registry: ExtensionContext["modelRegistry"];
  router: Router;
  decision: RoutingDecision;
  /** 있으면 tier models/limit을 실시간 추적함. */
  routers?: Record<string, Router>;
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
  router: Router,
  decision: RoutingDecision,
  routers?: Record<string, Router>,
): string[] => {
  if (routers) {
    const live = dereferenceTier(routers, decision.router, decision.tier)?.config.models;
    if (live?.length) return [...new Set(live)];
  }
  const tierModels = router[decision.tier]?.models;
  if (!tierModels?.length)
    return [formatModelRef(decision.targetProvider, decision.targetModelId, decision.effort)];
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

export const createRecordFailure =
  (state: DelegateParams["state"], routeChainKey: string) =>
  (ref: string): void => {
    const s = state.failedByChain.get(routeChainKey) ?? new Set<string>();
    if (!state.failedByChain.has(routeChainKey)) state.failedByChain.set(routeChainKey, s);
    s.add(normalizeFailedRef(ref));
  };

export const resolveTargetLimit = (
  router: Router,
  decision: RoutingDecision,
  modelRef: string,
  registry: ExtensionContext["modelRegistry"],
  targetProvider: string,
  targetModelId: string,
  routers?: Record<string, Router>,
): number => {
  if (routers) {
    for (const t of ROUTER_TIERS) {
      const live = dereferenceTier(routers, decision.router, t)?.config.models;
      if (live?.includes(modelRef)) {
        return resolveContextWindowLive(routers, decision.router, t, registry);
      }
    }
    const found = registry.find(targetProvider, targetModelId);
    return (
      found?.contextWindow ??
      resolveContextWindowLive(routers, decision.router, decision.tier, registry)
    );
  }
  for (const t of ROUTER_TIERS) {
    const tc = router[t];
    if (tc?.models?.includes(modelRef)) return resolveContextWindow(t, router, registry);
  }
  const found = registry.find(targetProvider, targetModelId);
  return found?.contextWindow ?? resolveContextWindow(decision.tier, router, registry);
};

export const buildEffectiveContext = (
  context: Context,
  targetLimit: number,
  routerModel: Model<Api>,
): Context =>
  targetLimit < (routerModel.contextWindow ?? Infinity)
    ? truncateContext(context, targetLimit)
    : context;

export const isContentEvent = (type: unknown): boolean =>
  type === "text_delta" ||
  type === "thinking_delta" ||
  type === "toolcall_delta" ||
  type === "toolcall_end";

/** 중첩 경로를 안전하게 읽는다. 중간이 객체가 아니면 undefined를 반환한다. */
const readPath = (root: unknown, keys: readonly string[]): unknown => {
  let current: unknown = root;
  for (const key of keys) {
    if (!isObjectRecord(current)) return undefined;
    current = current[key];
  }
  return current;
};

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
    const type = readPath(event, ["type"]);
    if (type === "done") {
      gotDone = true;
      const total = readPath(event, ["message", "usage", "cost", "total"]);
      pendingCostDelta = typeof total === "number" ? total : 0;
    } else if (type === "error") {
      gotError = true;
      const errorMessage = readPath(event, ["error", "errorMessage"]);
      if (typeof errorMessage === "string") bufferedErrorMessage = errorMessage;
    }
    if (isContentEvent(type)) contentReceived = true;
  }
  return { gotDone, gotError, bufferedErrorMessage, pendingCostDelta, contentReceived };
};

export const resolveAuthError = (
  auth: { ok: boolean; apiKey?: string; error?: string },
  targetProvider: string,
  targetModelId: string,
): Error =>
  !auth.ok
    ? new Error(`Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`)
    : new Error(`No API key for routed model: ${targetProvider}/${targetModelId}`);

export const shouldSkipRouterModel = (provider: string): boolean => provider === "router";

export const buildFallbackDecision = (decision: RoutingDecision, modelRef: string): void => {
  const { provider, modelId, effort } = parseCanonicalModelRef(modelRef);
  Object.assign(decision, {
    isFallback: true,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    effort: effort ?? decision.effort,
  });
};

type AttemptResult =
  | { status: "success"; costDelta: number }
  | { status: "retry"; error: unknown }
  | { status: "nonRetryable"; error: Error }
  | { status: "skip" };

export const attemptSingleModel = async (
  modelRef: string,
  index: number,
  params: DelegateParams,
  recordRouteFailure: (ref: string) => void,
): Promise<AttemptResult> => {
  const {
    registry,
    router,
    decision,
    routerModel,
    context,
    options,
    state,
    withCommitMutex,
    stream,
    recordDebugDecision,
  } = params;
  const { provider, modelId, effort } = parseCanonicalModelRef(modelRef);
  const tryThinking = effort ?? decision.effort;
  const routeChainKey = chainKeyForRoute(decision.router, decision.tier);
  const remember = (err: unknown): void => {
    rememberPreStreamFailure(err, modelRef, recordRouteFailure, routeChainKey);
  };
  if (shouldSkipRouterModel(provider)) return { status: "skip" };
  const targetModel = registry.find(provider, modelId);
  if (!targetModel) {
    const err = new Error(`Routed model not found: ${provider}/${modelId}`);
    remember(err);
    return { status: "retry", error: err };
  }
  const auth = await registry.getApiKeyAndHeaders(targetModel);
  if (!auth.ok || !auth.apiKey) {
    const err = resolveAuthError(auth, provider, modelId);
    remember(err);
    return { status: "retry", error: err };
  }
  if (options?.signal?.aborted) return { status: "nonRetryable", error: new Error("aborted") };
  const targetLimit = resolveTargetLimit(
    router,
    decision,
    modelRef,
    registry,
    provider,
    modelId,
    params.routers,
  );
  const effectiveContext = buildEffectiveContext(context, targetLimit, routerModel);
  const delegatedReasoning = resolveDelegatedReasoning(targetModel, tryThinking);
  try {
    const label = `Thinking (${provider}/${modelId})...`;
    if (delegatedReasoning) state.lastExtensionContext?.ui.setHiddenThinkingLabel?.(label);
    else state.lastExtensionContext?.ui.setHiddenThinkingLabel?.();
  } catch {}
  const {
    reasoning: _piReasoning,
    transformHeaders: _routerTransformHeaders,
    ...delegationOptions
  } = (options ?? {}) as SimpleStreamOptions & { transformHeaders?: unknown };
  let delegatedStream: AsyncIterable<AssistantMessageEvent>;
  try {
    delegatedStream = streamDelegated(
      registry,
      modelWithAuthBaseUrl(targetModel, auth),
      effectiveContext,
      {
        ...delegationOptions,
        apiKey: auth.apiKey,
        headers: mergeDelegatedHeaders(
          targetModel,
          delegationOptions.sessionId,
          delegationOptions.headers,
          (auth as { headers?: Record<string, string | null> }).headers,
        ),
        ...(delegatedReasoning ? { reasoning: delegatedReasoning } : {}),
      },
    );
  } catch (e) {
    remember(e);
    return { status: "retry", error: e };
  }
  if (!delegatedStream) {
    const err = new Error("No delegated stream available");
    remember(err);
    return { status: "retry", error: err };
  }
  const bufferedEvents: AssistantMessageEvent[] = [];
  let contentReceivedForTry = false;
  try {
    for await (const event of delegatedStream) {
      if (options?.signal?.aborted) throw new Error("aborted");
      bufferedEvents.push(event);
      if (isContentEvent(event.type)) contentReceivedForTry = true;
    }
  } catch (e) {
    if (e instanceof Error && e.message === "aborted")
      return { status: "nonRetryable", error: new Error("aborted") };
    throw e;
  }
  const collected = collectBufferedResult(bufferedEvents);
  contentReceivedForTry = collected.contentReceived || contentReceivedForTry;
  if (collected.gotDone) {
    for (const ev of bufferedEvents) stream.push(ev);
    if (collected.pendingCostDelta)
      await withCommitMutex(async () => {
        state.accumulatedCost += collected.pendingCostDelta;
      });
    if (index > 0) {
      buildFallbackDecision(decision, modelRef);
      await withCommitMutex(async () => {
        if (state.lastDecision === decision || state.lastDecision?.router === decision.router)
          state.lastDecision = { ...decision };
      });
      recordDebugDecision(decision);
    }
    return { status: "success", costDelta: collected.pendingCostDelta };
  }
  if (collected.gotError) {
    if (contentReceivedForTry) {
      for (const ev of bufferedEvents) stream.push(ev);
      return {
        status: "nonRetryable",
        error: new Error(
          `NON_RETRYABLE: ${collected.bufferedErrorMessage || "Model failed after sending content."}`,
        ),
      };
    }
    const err = new Error(collected.bufferedErrorMessage || "Model failed before sending content.");
    remember(err);
    return { status: "retry", error: err };
  }
  const err = new Error("Model stream ended without terminal event.");
  remember(err);
  return { status: "retry", error: err };
};

export const runDelegateAttempt = async (
  params: DelegateParams,
  curDecision: RoutingDecision,
): Promise<{ success: boolean; costDelta: number; lastError?: unknown }> => {
  const { router, state } = params;
  const initialModels = getInitialModelsToTry(router, curDecision, params.routers);
  const routeChainKey = chainKeyForRoute(curDecision.router, curDecision.tier);
  const recordRouteFailure = createRecordFailure(state, routeChainKey);
  const {
    filtered: modelsToTry,
    allFiltered,
    skipped: skippedDueToMemory,
  } = filterByFailureMemory(
    initialModels,
    failedRefsForChain(state.failedByChain.get(routeChainKey), routeChainKey),
  );
  if (allFiltered) {
    throw new Error(
      `All models in ${curDecision.tier} tier are marked failed this session (skipped: ${skippedDueToMemory.join(", ")}). Run /router reset-failures to retry.`,
    );
  }
  let lastError: unknown;
  let success = false;
  let costDelta = 0;
  for (let i = 0; i < modelsToTry.length; i++) {
    const result = await attemptSingleModel(
      modelsToTry[i],
      i,
      { ...params, decision: curDecision },
      recordRouteFailure,
    );
    if (result.status === "skip") continue;
    if (result.status === "success") {
      success = true;
      costDelta = result.costDelta;
      break;
    }
    if (result.status === "nonRetryable") {
      const msg = result.error.message;
      lastError = msg.startsWith("NON_RETRYABLE:")
        ? new Error(msg.slice("NON_RETRYABLE: ".length))
        : result.error;
      break;
    }
    lastError = result.error;
  }
  return { success, costDelta, lastError };
};

export const toDelegateResult = (
  attempt: { success: boolean; costDelta: number; lastError?: unknown },
  decision: RoutingDecision,
): DelegateResult => {
  if (attempt.success) {
    return {
      success: true,
      costDelta: attempt.costDelta,
      fallbackDecision: decision,
      lastError: attempt.lastError,
    };
  }
  return { success: false, costDelta: attempt.costDelta, lastError: attempt.lastError };
};

export const delegateToTierModels = async (params: DelegateParams): Promise<DelegateResult> => {
  const attempt = await runDelegateAttempt(params, params.decision);
  return toDelegateResult(attempt, params.decision);
};
