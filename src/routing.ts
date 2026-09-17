import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterTier, Router, RoutingDecision } from "./types";
import {
  parseCanonicalModelRef,
  formatModelRef,
  resolveAvailableTier,
  dereferenceTier,
  resolveAvailableTierLive,
} from "./config";

export { resolveAvailableTier };

export const thinkingToTier = (thinking: ThinkingLevel): RouterTier => {
  if (thinking === "max") return "max";
  if (thinking === "xhigh") return "xhigh";
  if (thinking === "high") return "high";
  if (thinking === "medium") return "medium";
  if (thinking === "low") return "low";
  return "minimal";
};

export const buildRoutingDecision = (
  routerName: string,
  router: Router,
  tier: RouterTier,
  reasoning: string,
  isClassifier?: boolean,
): RoutingDecision => {
  const routed = router[tier];
  if (!routed) {
    throw new Error(`Router "${routerName}" has no configuration for the ${tier} tier.`);
  }
  const primaryRef = routed.models![0];
  const { provider, modelId, effort } = parseCanonicalModelRef(primaryRef);
  // tier 강제 effort가 모델별 `#`보다 우선함.
  const effectiveEffort = routed.effort ?? effort;

  return {
    router: routerName,
    tier,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    reasoning,
    effort: effectiveEffort,
    timestamp: Date.now(),
    isClassifier,
  };
};

/**
 * tier의 `@` 위임을 실시간으로 펼쳐서 라우팅 결정을 만듦.
 * decision.router/tier는 요청한 원본 좌표를 유지하고, reasoning에 실제 해석 경로를 남김.
 */
export const buildRoutingDecisionLive = (
  routers: Record<string, Router>,
  routerName: string,
  tier: RouterTier,
  reasoning: string,
  isClassifier?: boolean,
): RoutingDecision => {
  const found = resolveAvailableTierLive(routers, routerName, tier);
  if (!found) {
    throw new Error(`Router "${routerName}" has no resolvable configuration for ${tier} tier.`);
  }
  const { provider, modelId, effort } = parseCanonicalModelRef(found.resolved.config.models![0]!);
  // tier 강제 effort가 모델별 `#`보다 우선함.
  const effectiveEffort = found.resolved.config.effort ?? effort;
  let finalReasoning = reasoning;
  if (found.tier !== tier) {
    finalReasoning = `Resolved from ${tier} to ${found.tier} tier (${tier} tier is not configured). Original: ${reasoning}`;
  }
  if (
    found.resolved.routerName !== routerName ||
    found.resolved.tier !== found.tier ||
    found.resolved.chain.length > 1
  ) {
    finalReasoning = `${finalReasoning} [ref: ${found.resolved.chain.join(" -> ")}]`;
  }
  return {
    router: routerName,
    tier: found.tier,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    reasoning: finalReasoning,
    effort: effectiveEffort,
    timestamp: Date.now(),
    isClassifier,
  };
};

export const decideRouting = (
  _context: Context,
  routerName: string,
  router: Router,
  _previousDecision: RoutingDecision | undefined,
  routers?: Record<string, Router>,
): RoutingDecision => {
  // Intentionally simplified: _context and _previousDecision are currently unused.
  // Routing defaults to medium; classifier (if configured) overrides this via provider.ts.
  // Future heuristics / phase-bias may use these parameters.
  if (routers) {
    return buildRoutingDecisionLive(
      routers,
      routerName,
      "medium",
      "Defaulted to medium tier for general coding work.",
      false,
    );
  }
  const tier: RouterTier = "medium";
  let reasoning = "Defaulted to medium tier for general coding work.";

  const resolvedTier = resolveAvailableTier(router, tier);
  if (resolvedTier !== tier) {
    reasoning = `Resolved from ${tier} to ${resolvedTier} tier (${tier} tier is not configured). Original: ${reasoning}`;
    return buildRoutingDecision(routerName, router, resolvedTier, reasoning, false);
  }

  const decision = buildRoutingDecision(routerName, router, tier, reasoning, false);
  return decision;
};

/** 결정된 tier의 실제 모델 목록을 실시간 추적해서 반환함 (delegate 폴백용). */
export const resolveTierModelsLive = (
  routers: Record<string, Router>,
  routerName: string,
  tier: RouterTier,
): string[] | undefined => dereferenceTier(routers, routerName, tier)?.config.models;
