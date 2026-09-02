import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildPersistedState } from "../state/build";
import type { RouterState } from "../state/create";

export const createSetModelInternally = (
  pi: { setModel: (m: unknown) => Promise<boolean> },
  state: RouterState,
) => {
  const fn = async (model: NonNullable<ExtensionContext["model"]>): Promise<boolean> => {
    state.isInternalModelSwitch++;
    try {
      return await pi.setModel(model);
    } catch {
      return false;
    } finally {
      state.isInternalModelSwitch--;
    }
  };
  return fn;
};

export const createPersistState = (
  pi: { appendEntry: (t: string, d: unknown) => void },
  state: RouterState,
) => {
  const fn = (): void => {
    const s = buildPersistedState(
      state.routerEnabled,
      state.selectedProfile,
      state.debugEnabled,
      state.debugHistory,
      state.lastDecision,
      state.lastNonRouterModel,
      state.accumulatedCost,
    );
    const snapshot = JSON.stringify({
      ...s,
      timestamp: 0,
      lastDecision: s.lastDecision ? { ...s.lastDecision, timestamp: 0 } : undefined,
      debugHistory: s.debugHistory?.map((d) => ({ ...d, timestamp: 0 })),
    });
    if (snapshot === state.lastPersistedSnapshot) return;
    try {
      pi.appendEntry("router-state", s);
    } catch {
      return;
    }
    state.lastPersistedSnapshot = snapshot;
  };
  return fn;
};

export const createSessionHelpers = (
  pi: { appendEntry: (t: string, d: unknown) => void; setModel: (m: unknown) => Promise<boolean> },
  state: RouterState,
) => ({
  setModelInternally: createSetModelInternally(pi, state),
  persistState: createPersistState(pi, state),
});
