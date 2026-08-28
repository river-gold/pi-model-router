import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
  RoutingDecision,
  RouterPinByProfile,
  RouterThinkingByProfile,
} from './types';

const getEffectiveThinking = (
  thinkingByProfile: RouterThinkingByProfile,
  profileName: string,
  decision: RoutingDecision,
) => thinkingByProfile[profileName]?.[decision.tier] ?? decision.thinking;

export const formatDecision = (decision: RoutingDecision): string => {
  return `${decision.profile}: ${decision.tier} -> ${decision.targetProvider}/${decision.targetModelId} [${decision.thinking}] (${decision.reasoning})`;
};

export const formatPinSummary = (
  pinnedTierByProfile: RouterPinByProfile,
): string => {
  const entries = Object.entries(pinnedTierByProfile)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([profile, tier]) => `${profile}:${tier}`);
  return entries.length > 0 ? entries.join(', ') : 'none';
};

export const formatThinkingSummary = (
  thinkingByProfile: RouterThinkingByProfile,
): string => {
  const entries = Object.entries(thinkingByProfile)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([profile, tierMap]) => {
      const tiers = Object.entries(tierMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tier, level]) => `${tier}:${level}`);
      return `${profile}(${tiers.join(',')})`;
    });
  return entries.length > 0 ? entries.join(', ') : 'none';
};

export const formatModelRef = (ref: string | undefined): string => {
  return ref ?? 'none';
};

export const updateStatus = (
  ctx: ExtensionContext,
  routerEnabled: boolean,
  selectedProfile: string | undefined,
  pinnedTierByProfile: RouterPinByProfile,
  thinkingByProfile: RouterThinkingByProfile,
  lastDecision: RoutingDecision | undefined,
) => {
  const activeRouterProfile = routerEnabled ? selectedProfile : undefined;
  const statusProfile = selectedProfile ?? 'none';
  const activePin = selectedProfile ? pinnedTierByProfile[selectedProfile] : undefined;
  const pinLabel = activePin ? ` [pin:${activePin}]` : '';

  if (activeRouterProfile) {
    const matchesProfile =
      lastDecision && lastDecision.profile === activeRouterProfile;
    const matchesPin = activePin ? lastDecision?.tier === activePin : true;

    let statusText: string;
    if (lastDecision && matchesProfile && matchesPin) {
      const effectiveThinking = getEffectiveThinking(
        thinkingByProfile,
        activeRouterProfile,
        lastDecision,
      );
      statusText = `router:${activeRouterProfile}${pinLabel} -> ${lastDecision.tier} -> ${lastDecision.targetProvider}/${lastDecision.targetModelId} (${effectiveThinking})`;
    } else {
      statusText = `router:${activeRouterProfile}${pinLabel} -> waiting`;
    }
    ctx.ui.setStatus('router', `🚥 ${statusText}`);
  } else {
    ctx.ui.setStatus('router', undefined);
  }
};
