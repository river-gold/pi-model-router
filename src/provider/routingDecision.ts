import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterProfile, RoutingDecision, RouterTier } from "../types";
import {
  buildRoutingDecision,
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
  } = params;
  let decision: RoutingDecision = decideRouting(
    context,
    profileName,
    profile,
    snapshotLastDecision,
  );
  const isSingleTier = validTierCount === 1 && singleTier !== undefined;
  if (isToolLoop && snapshotLastDecision) {
    decision = buildRoutingDecision(
      profileName,
      profile,
      snapshotLastDecision.tier,
      `Preserved ${snapshotLastDecision.tier} tier during toolResult loop`,
      false,
    );
  }
  if (isSingleTier && !isToolLoop) {
    decision = buildRoutingDecision(
      profileName,
      profile,
      singleTier,
      `Single tier "${singleTier}" defined — skipping classifier/thinking mapping.`,
      false,
    );
  } else if (thinkingLevel !== "off" && !isToolLoop) {
    const preferred = thinkingToTier(thinkingLevel);
    const tier = resolveAvailableTier(profile, preferred);
    let reasoning = `Thinking level ${thinkingLevel} mapped to ${tier} tier.`;
    if (tier !== preferred) {
      reasoning = `Thinking level ${thinkingLevel} mapped to ${preferred} tier, resolved to ${tier} (${preferred} tier is not configured).`;
    }
    decision = buildRoutingDecision(profileName, profile, tier, reasoning, false);
  }
  return decision;
};
