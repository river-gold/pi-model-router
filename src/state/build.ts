import type { RouterPersistedState, RoutingDecision } from "../types";

export const buildPersistedState = (
  routerEnabled: boolean,
  selectedProfile: string | undefined,
  debugEnabled: boolean,
  debugHistory: RoutingDecision[],
  lastDecision: RoutingDecision | undefined,
  lastNonRouterModel: string | undefined,
  accumulatedCost: number,
): RouterPersistedState => ({
  enabled: routerEnabled,
  selectedProfile: selectedProfile ?? "",
  debugEnabled,
  debugHistory,
  lastDecision,
  lastNonRouterModel,
  accumulatedCost,
  timestamp: Date.now(),
});
