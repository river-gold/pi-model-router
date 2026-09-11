import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterProfile, RoutingDecision, RouterTier } from "../types";
import {
  buildRoutingDecision,
  buildRoutingDecisionLive,
  decideRouting,
  resolveAvailableTier,
  thinkingToTier,
} from "../routing";

export type ResolveRoutingDecisionParams = {
  profileName: string;
  profile: RouterProfile;
  context: Context;
  snapshotLastDecision: RoutingDecision | undefined;
  thinkingLevel: ThinkingLevel;
  isToolLoop: boolean;
  singleTier: RouterTier | undefined;
  validTierCount: number;
  /** 있으면 ref를 실시간 추적함. 없으면 기존 concrete 동작. */
  profiles?: Record<string, RouterProfile>;
};

// resolveRoutingDecision: thinking single-tier and effort mapping
// Signature keeps profile, thinkingLevel, isToolLoop, singleTier, validTierCount
// as core inputs; additional context/profileName needed for RoutingDecision.
export const resolveRoutingDecision = (params: ResolveRoutingDecisionParams): RoutingDecision => {
  const {
    profileName,
    profile,
    context,
    snapshotLastDecision,
    thinkingLevel,
    isToolLoop,
    singleTier,
    validTierCount,
    profiles,
  } = params;
  const build = (tier: RouterTier, reasoning: string, isClassifier?: boolean): RoutingDecision =>
    profiles
      ? buildRoutingDecisionLive(profiles, profileName, tier, reasoning, isClassifier)
      : buildRoutingDecision(profileName, profile, tier, reasoning, isClassifier);

  let decision: RoutingDecision = profiles
    ? decideRouting(context, profileName, profile, snapshotLastDecision, profiles)
    : decideRouting(context, profileName, profile, snapshotLastDecision);
  const isSingleTier = validTierCount === 1 && singleTier !== undefined;
  if (isToolLoop && snapshotLastDecision) {
    decision = build(
      snapshotLastDecision.tier,
      `Preserved ${snapshotLastDecision.tier} tier during toolResult loop`,
      false,
    );
  }
  if (isSingleTier && !isToolLoop) {
    decision = build(
      singleTier,
      `Single tier "${singleTier}" defined — skipping classifier/thinking mapping.`,
      false,
    );
  } else if (thinkingLevel !== "off" && !isToolLoop) {
    const preferred = thinkingToTier(thinkingLevel);
    if (profiles) {
      // live 빌드가 가까운 tier 폴백과 ref 경로 표기를 직접 처리함.
      decision = build(
        preferred,
        `Thinking level ${thinkingLevel} mapped to ${preferred} tier.`,
        false,
      );
    } else {
      const tier = resolveAvailableTier(profile, preferred);
      let reasoning = `Thinking level ${thinkingLevel} mapped to ${tier} tier.`;
      if (tier !== preferred) {
        reasoning = `Thinking level ${thinkingLevel} mapped to ${preferred} tier, resolved to ${tier} (${preferred} tier is not configured).`;
      }
      decision = build(tier, reasoning, false);
    }
  }
  return decision;
};
