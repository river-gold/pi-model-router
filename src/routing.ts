import type { Context } from '@earendil-works/pi-ai';
import type {
  RouterTier,
  RouterProfile,
  RoutingDecision,
} from './types';
import { parseCanonicalModelRef } from './config';

// Re-export context utilities and classifier for backward compat (tests import from routing)
export {
  extractTextFromContent,
  getLastUserText,
  getHistoryPairsText,
  getPromptWithHistory,
  hasImageAttachment,
  estimateTokens,
  truncateContext,
} from './context';
export { runClassifier, CLASSIFIER_SYSTEM_PROMPT } from './classifier';

export const resolveAvailableTier = (
  profile: RouterProfile,
  preferred: RouterTier,
): RouterTier => {
  if (profile[preferred]) return preferred;
  const order: RouterTier[] = ['low', 'medium', 'high'];
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
  const { provider, modelId } = parseCanonicalModelRef(routed.model);
  const effectiveThinking =
    routed.thinking ??
    (tier === 'high' ? 'high' : tier === 'low' ? 'low' : 'medium');

  return {
    profile: profileName,
    tier,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: routed.model,
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
