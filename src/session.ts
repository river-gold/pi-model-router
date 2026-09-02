/* oxlint-disable */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadRouterConfig, profileNames, resolveProfileName } from "./config";
import { MAX_DEBUG_HISTORY } from "./constants";
import { buildPersistedState, isRouterPersistedState } from "./state";
import type { RouterState } from "./state";
import type { CustomSessionEntry } from "./types";
import { updateStatus } from "./ui";

export const SESSION_RESTORE_DELAY_MS = 50;

export const createSessionHelpers = (
  pi: { appendEntry: (t: string, d: unknown) => void; setModel: (m: unknown) => Promise<boolean> },
  state: RouterState,
) => {
  const setModelInternally = async (model: NonNullable<ExtensionContext["model"]>): Promise<boolean> => {
    state.isInternalModelSwitch++;
    try {
      return await pi.setModel(model);
    } catch {
      return false;
    } finally {
      state.isInternalModelSwitch--;
    }
  };

  const persistState = (): void => {
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

  return { setModelInternally, persistState };
};

export const restoreStateFromSession = async (
  ctx: ExtensionContext,
  state: RouterState,
  helpers: { setModelInternally: (m: NonNullable<ExtensionContext["model"]>) => Promise<boolean>; persistState: () => void },
  actions: { reloadConfig: (ctx?: ExtensionContext, opts?: { preserveDebug?: boolean }) => void; ensureValidActiveRouterProfile: (ctx: ExtensionContext) => Promise<void> },
): Promise<void> => {
  state.lastExtensionContext = ctx;
  state.currentModelRegistry = ctx.modelRegistry;
  state.currentCwd = ctx.cwd;
  actions.reloadConfig(ctx);
  await new Promise<void>((resolve) => setTimeout(resolve, SESSION_RESTORE_DELAY_MS));
  state.routerEnabled = ctx.model?.provider === "router";
  state.selectedProfile =
    ctx.model?.provider === "router"
      ? resolveProfileName(state.currentConfig, ctx.model.id)
      : resolveProfileName(state.currentConfig, state.selectedProfile);
  state.debugHistory = [];
  state.accumulatedCost = 0;
  state.lastNonRouterModel =
    ctx.model && ctx.model.provider !== "router"
      ? `${ctx.model.provider}/${ctx.model.id}`
      : state.lastNonRouterModel;
  state.lastDecision = undefined;
  const entries = ctx.sessionManager.getBranch() as CustomSessionEntry[];
  const savedState = entries
    .filter((entry) => entry.type === "custom" && entry.customType === "router-state")
    .map((entry) => entry.data)
    .findLast((data) => isRouterPersistedState(data));
  if (isRouterPersistedState(savedState)) {
    state.selectedProfile = resolveProfileName(state.currentConfig, savedState.selectedProfile);
    state.routerEnabled = savedState.enabled;
    state.debugEnabled = savedState.debugEnabled ?? state.debugEnabled;
    state.debugHistory = savedState.debugHistory
      ? [...savedState.debugHistory].slice(-MAX_DEBUG_HISTORY)
      : [];
    state.lastNonRouterModel = savedState.lastNonRouterModel ?? state.lastNonRouterModel;
    state.accumulatedCost = savedState.accumulatedCost ?? 0;
    state.lastDecision = savedState.lastDecision;
  }
  await actions.ensureValidActiveRouterProfile(ctx);
  if (state.routerEnabled && state.selectedProfile) {
    const routerModel = ctx.modelRegistry.find("router", state.selectedProfile);
    if (routerModel) {
      const success = await helpers.setModelInternally(routerModel);
      if (!success) {
        ctx.ui.notify(`Failed to restore router/${state.selectedProfile} after relaunch.`, "warning");
        state.routerEnabled = false;
      }
    } else {
      ctx.ui.notify(`Unable to restore router/${state.selectedProfile}; model is unavailable.`, "warning");
      state.routerEnabled = false;
      ctx.ui.setHiddenThinkingLabel?.();
    }
  } else {
    ctx.ui.setHiddenThinkingLabel?.();
  }
  helpers.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
};
