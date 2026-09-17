import type { RouterPersistedState, RoutingDecision } from "../types";

export const buildPersistedState = (
  routerEnabled: boolean,
  selectedRouter: string | undefined,
  debugEnabled: boolean,
  debugHistory: RoutingDecision[],
  lastDecision: RoutingDecision | undefined,
  lastNonRouterModel: string | undefined,
  accumulatedCost: number,
): RouterPersistedState => ({
  enabled: routerEnabled,
  selectedRouter: selectedRouter ?? "",
  debugEnabled,
  debugHistory,
  lastDecision,
  lastNonRouterModel,
  accumulatedCost,
  timestamp: Date.now(),
});
