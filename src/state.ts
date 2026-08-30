import type {
  RoutingDecision,
  RouterPersistedState,
} from './types';

export const isRouterPersistedState = (
  value: unknown,
): value is RouterPersistedState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (
    typeof v.enabled !== 'boolean' ||
    typeof v.selectedProfile !== 'string' ||
    typeof v.timestamp !== 'number'
  ) {
    return false;
  }
  if (v.debugHistory !== undefined && !Array.isArray(v.debugHistory)) {
    return false;
  }
  if (
    v.accumulatedCost !== undefined &&
    (typeof v.accumulatedCost !== 'number' ||
      !Number.isFinite(v.accumulatedCost) ||
      v.accumulatedCost < 0)
  ) {
    return false;
  }
  if (v.lastDecision !== undefined && v.lastDecision !== null) {
    if (typeof v.lastDecision !== 'object' || Array.isArray(v.lastDecision)) {
      return false;
    }
    const d = v.lastDecision as Record<string, unknown>;
    if (
      typeof d.profile !== 'string' ||
      typeof d.tier !== 'string' ||
      typeof d.targetProvider !== 'string' ||
      typeof d.targetModelId !== 'string'
    ) {
      return false;
    }
  }
  if (v.debugEnabled !== undefined && typeof v.debugEnabled !== 'boolean') {
    return false;
  }
  if (
    v.lastNonRouterModel !== undefined &&
    typeof v.lastNonRouterModel !== 'string'
  ) {
    return false;
  }
  return true;
};

export const buildPersistedState = (
  routerEnabled: boolean,
  selectedProfile: string | undefined,
  debugEnabled: boolean,
  debugHistory: RoutingDecision[],
  lastDecision: RoutingDecision | undefined,
  lastNonRouterModel: string | undefined,
  accumulatedCost: number,
): RouterPersistedState => {
  return {
    enabled: routerEnabled,
    selectedProfile: selectedProfile ?? '',
    debugEnabled,
    debugHistory,
    lastDecision,
    lastNonRouterModel,
    accumulatedCost,
    timestamp: Date.now(),
  };
};
