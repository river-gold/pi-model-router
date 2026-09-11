import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterTier, RouterProfile, RoutingDecision } from "./types";
import {
  parseCanonicalModelRef,
  formatModelRef,
  resolveAvailableTier,
  dereferenceTier,
  isTierRef,
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
  profileName: string,
  profile: RouterProfile,
  tier: RouterTier,
  reasoning: string,
  isClassifier?: boolean,
): RoutingDecision => {
  const routed = profile[tier];
  if (!routed) {
    throw new Error(`Profile "${profileName}" has no configuration for the ${tier} tier.`);
  }
  if (isTierRef(routed)) {
    throw new Error(
      `Profile "${profileName}" ${tier} tier is a logical ref ("${routed.ref}"). Use buildRoutingDecisionLive with the full profiles map to resolve it.`,
    );
  }
  const primaryRef = routed.models![0];
  const { provider, modelId, thinking } = parseCanonicalModelRef(primaryRef);
  const effectiveThinking = thinking ?? routed.thinking;

  return {
    profile: profileName,
    tier,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    reasoning,
    thinking: effectiveThinking,
    timestamp: Date.now(),
    isClassifier,
  };
};

/**
 * 논리적 ref를 실시간 추적해서 라우팅 결정을 만듦.
 * decision.profile/tier는 요청한 원본 좌표를 유지하고, reasoning에 실제 해석 경로를 남김.
 */
export const buildRoutingDecisionLive = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
  reasoning: string,
  isClassifier?: boolean,
): RoutingDecision => {
  const found = resolveAvailableTierLive(profiles, profileName, tier);
  if (!found) {
    throw new Error(`Profile "${profileName}" has no resolvable configuration for ${tier} tier.`);
  }
  const { provider, modelId, thinking } = parseCanonicalModelRef(found.resolved.config.models![0]!);
  const effectiveThinking = thinking ?? found.resolved.config.thinking;
  let finalReasoning = reasoning;
  if (found.tier !== tier) {
    finalReasoning = `Resolved from ${tier} to ${found.tier} tier (${tier} tier is not configured). Original: ${reasoning}`;
  }
  if (
    found.resolved.profileName !== profileName ||
    found.resolved.tier !== found.tier ||
    found.resolved.chain.length > 1
  ) {
    finalReasoning = `${finalReasoning} [ref: ${found.resolved.chain.join(" -> ")}]`;
  }
  return {
    profile: profileName,
    tier: found.tier,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: formatModelRef(provider, modelId),
    reasoning: finalReasoning,
    thinking: effectiveThinking,
    timestamp: Date.now(),
    isClassifier,
  };
};

export const decideRouting = (
  _context: Context,
  profileName: string,
  profile: RouterProfile,
  _previousDecision: RoutingDecision | undefined,
  profiles?: Record<string, RouterProfile>,
): RoutingDecision => {
  // Intentionally simplified: _context and _previousDecision are currently unused.
  // Routing defaults to medium; classifier (if configured) overrides this via provider.ts.
  // Future heuristics / phase-bias may use these parameters.
  if (profiles) {
    return buildRoutingDecisionLive(
      profiles,
      profileName,
      "medium",
      "Defaulted to medium tier for general coding work.",
      false,
    );
  }
  const tier: RouterTier = "medium";
  let reasoning = "Defaulted to medium tier for general coding work.";

  const resolvedTier = resolveAvailableTier(profile, tier);
  if (resolvedTier !== tier) {
    reasoning = `Resolved from ${tier} to ${resolvedTier} tier (${tier} tier is not configured). Original: ${reasoning}`;
    return buildRoutingDecision(profileName, profile, resolvedTier, reasoning, false);
  }

  const decision = buildRoutingDecision(profileName, profile, tier, reasoning, false);
  return decision;
};

/** 결정된 tier의 실제 모델 목록을 실시간 추적해서 반환함 (delegate 폴백용). */
export const resolveTierModelsLive = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
): string[] | undefined => dereferenceTier(profiles, profileName, tier)?.config.models;
