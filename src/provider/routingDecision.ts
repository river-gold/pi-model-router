import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Router, RoutingDecision, RouterTier } from "../types";
import {
  buildRoutingDecision,
  buildRoutingDecisionLive,
  decideRouting,
  resolveAvailableTier,
  thinkingToTier,
} from "../routing";

export type ResolveRoutingDecisionParams = {
  routerName: string;
  router: Router;
  context: Context;
  snapshotLastDecision: RoutingDecision | undefined;
  thinkingLevel: ThinkingLevel;
  isToolLoop: boolean;
  singleTier: RouterTier | undefined;
  validTierCount: number;
  /** 있으면 ref를 실시간 추적함. 없으면 기존 concrete 동작. */
  routers?: Record<string, Router>;
};

// resolveRoutingDecision: thinking single-tier and effort mapping
// Signature keeps router, thinkingLevel, isToolLoop, singleTier, validTierCount
// as core inputs; additional context/routerName needed for RoutingDecision.
export const resolveRoutingDecision = (params: ResolveRoutingDecisionParams): RoutingDecision => {
  const {
    routerName,
    router,
    context,
    snapshotLastDecision,
    thinkingLevel,
    isToolLoop,
    singleTier,
    validTierCount,
    routers,
  } = params;
  const build = (tier: RouterTier, reasoning: string): RoutingDecision =>
    routers
      ? buildRoutingDecisionLive(routers, routerName, tier, reasoning)
      : buildRoutingDecision(routerName, router, tier, reasoning);

  let decision: RoutingDecision = routers
    ? decideRouting(context, routerName, router, snapshotLastDecision, routers)
    : decideRouting(context, routerName, router, snapshotLastDecision);
  const isSingleTier = validTierCount === 1 && singleTier !== undefined;
  if (isToolLoop && snapshotLastDecision) {
    decision = build(
      snapshotLastDecision.tier,
      `Preserved ${snapshotLastDecision.tier} tier during toolResult loop`,
    );
  }
  if (isSingleTier && !isToolLoop) {
    decision = build(
      singleTier,
      `Single tier "${singleTier}" defined — skipping thinking mapping.`,
    );
  } else if (!isToolLoop) {
    const preferred = thinkingToTier(thinkingLevel);
    if (routers) {
      // live 빌드가 가까운 tier 폴백과 ref 경로 표기를 직접 처리함.
      decision = build(preferred, `Thinking level ${thinkingLevel} mapped to ${preferred} tier.`);
    } else {
      const tier = resolveAvailableTier(router, preferred);
      let reasoning = `Thinking level ${thinkingLevel} mapped to ${tier} tier.`;
      if (tier !== preferred) {
        reasoning = `Thinking level ${thinkingLevel} mapped to ${preferred} tier, resolved to ${tier} (${preferred} tier is not configured).`;
      }
      decision = build(tier, reasoning);
    }
  }
  return decision;
};
