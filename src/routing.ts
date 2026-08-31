import type { Context } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  RouterTier,
  RouterProfile,
  RoutingDecision,
} from './types';
import { parseCanonicalModelRef, formatModelRef } from './config';

export const thinkingToTier = (thinking: ThinkingLevel): RouterTier => {
  if (thinking === 'xhigh' || thinking === 'max') return 'xhigh';
  if (thinking === 'high') return 'high';
  if (thinking === 'medium') return 'medium';
  if (thinking === 'low') return 'low';
  return 'minimal';
};

export const resolveAvailableTier = (
  profile: RouterProfile,
  preferred: RouterTier,
): RouterTier => {
  if (profile[preferred]) return preferred;
  const order: RouterTier[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const startIdx = order.indexOf(preferred);
  for (let i = startIdx + 1; i < order.length; i++) {
    if (profile[order[i]]) return order[i];
  }
  for (let i = startIdx - 1; i >= 0; i--) {
    if (profile[order[i]]) return order[i];
  }
  return preferred;
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

export const decideRouting = (
  _context: Context,
  profileName: string,
  profile: RouterProfile,
  _previousDecision: RoutingDecision | undefined,
): RoutingDecision => {
  // Intentionally simplified: _context and _previousDecision are currently unused.
  // Routing defaults to medium; classifier (if configured) overrides this via provider.ts.
  // Future heuristics / phase-bias may use these parameters.
  let tier: RouterTier = 'medium';
  let reasoning = 'Defaulted to medium tier for general coding work.';

  const resolvedTier = resolveAvailableTier(profile, tier);
  if (resolvedTier !== tier) {
    reasoning = `Resolved from ${tier} to ${resolvedTier} tier (${tier} tier is not configured). Original: ${reasoning}`;
    tier = resolvedTier;
  }

  const decision = buildRoutingDecision(
    profileName,
    profile,
    tier,
    reasoning,
    false,
  );
  return decision;
};
