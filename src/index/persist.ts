import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildPersistedState, isEqualPersistedState } from "../state";
import type { RouterState } from "../state";
import type { RoutingDecision } from "../types";
import { MAX_DEBUG_HISTORY } from "../constants";

export const createPersistState = (pi: ExtensionAPI, state: RouterState) => {
  const fn = (): void => {
    const snapshot = JSON.stringify({
      ...buildPersistedState(
        state.routerEnabled,
        state.selectedProfile,
        state.debugEnabled,
        state.debugHistory,
        state.lastDecision,
        state.lastNonRouterModel,
        state.accumulatedCost,
      ),
      timestamp: 0,
      lastDecision: state.lastDecision ? { ...state.lastDecision, timestamp: 0 } : undefined,
      debugHistory: state.debugHistory?.map((d) => ({ ...d, timestamp: 0 })),
    });
    if (isEqualPersistedState(state.lastPersistedSnapshot, snapshot)) return;
    try {
      pi.appendEntry(
        "router-state",
        buildPersistedState(
          state.routerEnabled,
          state.selectedProfile,
          state.debugEnabled,
          state.debugHistory,
          state.lastDecision,
          state.lastNonRouterModel,
          state.accumulatedCost,
        ),
      );
    } catch {
      return;
    }
    state.lastPersistedSnapshot = snapshot;
  };
  return fn;
};

export const createRecordDebugDecision = (state: RouterState) => {
  const fn = (decision: RoutingDecision): void => {
    state.debugHistory = [...state.debugHistory, decision].slice(-MAX_DEBUG_HISTORY);
  };
  return fn;
};
