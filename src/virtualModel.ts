import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionVirtualModel,
  ModelRoute,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedTier } from "./config";
import type { Router, RouterConfig, RouterTier, RoutingDecision } from "./types";
import {
  ALLOWED_THINKING,
  ROUTER_TIERS,
  formatModelRef,
  parseCanonicalModelRef,
  resolvableTiers,
  resolveAvailableTierLive,
  resolveContextWindowLive,
  resolveMaxTokensLive,
} from "./config";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, ROUTER_PROVIDER } from "./constants";
import { thinkingToTier } from "./routing";

/** 라우터별로 세션 브랜치에 저장되는 상태. */
export interface RouterRouteState {
  /** 해석된 tier -> 선택된 모델 ref. `random` 라우터의 세션 내 선택 유지용. */
  selections: Record<string, string>;
}

export type DecisionRecorder = (decision: RoutingDecision) => void;

type Candidate = { ref: string; model: Model<Api> };

/** 라우터의 모든 tier 중 가장 큰 limit을 노출한다 (첫 응답 전 표시용). */
export const routerLimits = (
  routers: Record<string, Router>,
  routerName: string,
  registry: ExtensionContext["modelRegistry"] | undefined,
): { contextWindow: number; maxTokens: number } => {
  let contextWindow = DEFAULT_CONTEXT_WINDOW;
  let maxTokens = DEFAULT_MAX_TOKENS;
  for (const tier of ROUTER_TIERS) {
    if (!routers[routerName]?.[tier]) continue;
    contextWindow = Math.max(
      contextWindow,
      resolveContextWindowLive(routers, routerName, tier, registry),
    );
    maxTokens = Math.max(maxTokens, resolveMaxTokensLive(routers, routerName, tier, registry));
  }
  return { contextWindow, maxTokens };
};

const resolveTier = (
  routers: Record<string, Router>,
  routerName: string,
  thinkingLevel: ModelThinkingLevel,
): { tier: RouterTier; resolved: ResolvedTier } => {
  const tiers = resolvableTiers(routers, routerName);
  const preferred = tiers.length === 1 ? tiers[0]! : thinkingToTier(thinkingLevel);
  const found = resolveAvailableTierLive(routers, routerName, preferred);
  if (!found) throw new Error(`Router "${routerName}" has no resolvable tier.`);
  return found;
};

/** 후보 중 물리 모델이 존재하고 자격 증명이 있는 항목만 남긴다. */
const usableCandidates = async (
  candidates: readonly string[],
  ctx: ExtensionContext,
): Promise<Candidate[]> => {
  const usable: Candidate[] = [];
  for (const ref of candidates) {
    const { provider, modelId } = parseCanonicalModelRef(ref);
    if (provider === ROUTER_PROVIDER) continue;
    const model = ctx.modelRegistry.find(provider, modelId);
    if (!model) continue;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) continue;
    usable.push({ ref, model });
  }
  return usable;
};

const chooseCandidate = (
  pool: readonly Candidate[],
  random: boolean,
  tier: RouterTier,
  state: RouterRouteState | undefined,
): { chosen: Candidate; state: RouterRouteState | undefined } => {
  if (random) {
    const saved = state?.selections[tier];
    const kept = pool.find((candidate) => candidate.ref === saved);
    if (kept) return { chosen: kept, state };
    const chosen = pool[Math.floor(Math.random() * pool.length)]!;
    return { chosen, state: { selections: { ...state?.selections, [tier]: chosen.ref } } };
  }
  return { chosen: pool[0]!, state };
};

const routeRequest = async (
  request: ModelRouteRequest<RouterRouteState>,
  ctx: ExtensionContext,
  routerName: string,
  routers: Record<string, Router>,
  record: DecisionRecorder,
): Promise<ModelRoute<RouterRouteState>> => {
  const router = routers[routerName];
  if (!router) throw new Error(`Router "${routerName}" is no longer configured.`);

  // 툴 루프/재시도 캐시 유지: 직전에 응답한 물리 모델을 그대로 사용한다.
  if (request.reason === "continuation" && request.previous) {
    return {
      model: request.previous.model,
      thinkingLevel: request.previous.thinkingLevel ?? request.thinkingLevel,
      state: request.state,
    };
  }

  const { tier, resolved } = resolveTier(routers, routerName, request.thinkingLevel);
  const usable = await usableCandidates(resolved.config.models, ctx);
  if (usable.length === 0) {
    throw new Error(`Router "${routerName}" ${tier} tier has no usable model.`);
  }
  const failedModel = request.reason === "retry" ? request.failed?.model : undefined;
  const withoutFailed = failedModel
    ? usable.filter((candidate) => {
        const { provider, modelId } = parseCanonicalModelRef(candidate.ref);
        return provider !== failedModel.provider || modelId !== failedModel.id;
      })
    : usable;
  const pool = withoutFailed.length > 0 ? withoutFailed : usable;

  const { chosen, state } = chooseCandidate(pool, router.random === true, tier, request.state);
  const { provider, modelId, effort } = parseCanonicalModelRef(chosen.ref);

  record({
    router: routerName,
    tier,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    reasoning: `Thinking level ${request.thinkingLevel} mapped to ${tier} tier.`,
    effort,
    timestamp: Date.now(),
  });

  return { model: chosen.model, thinkingLevel: effort ?? request.thinkingLevel, state };
};

/** 라우터 하나를 pi 가상 모델로 변환한다. */
export const createVirtualModel = (
  routers: Record<string, Router>,
  routerName: string,
  registry: ExtensionContext["modelRegistry"] | undefined,
  record: DecisionRecorder,
): ExtensionVirtualModel<RouterRouteState> => {
  const { contextWindow, maxTokens } = routerLimits(routers, routerName, registry);
  return {
    provider: ROUTER_PROVIDER,
    id: routerName,
    name: `Router ${routerName}`,
    thinkingLevels: ALLOWED_THINKING,
    contextWindow,
    maxTokens,
    input: ["text", "image"],
    route: (request, ctx) => routeRequest(request, ctx, routerName, routers, record),
  };
};

/**
 * 설정에 있는 라우터를 가상 모델로 등록하고, 사라진 라우터는 해제한다.
 * 같은 provider/id 재등록은 교체이므로 reload 시 그대로 호출하면 된다.
 */
export const createVirtualModelRegistrar = (pi: ExtensionAPI) => {
  let registered: string[] = [];
  return (
    config: RouterConfig,
    registry: ExtensionContext["modelRegistry"] | undefined,
    record: DecisionRecorder,
  ): void => {
    const names = Object.keys(config.routers);
    for (const name of names) {
      pi.registerVirtualModel(createVirtualModel(config.routers, name, registry, record));
    }
    for (const removed of registered) {
      if (!names.includes(removed)) pi.unregisterVirtualModel(ROUTER_PROVIDER, removed);
    }
    registered = names;
  };
};
