import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveProfileName } from "../config/profile";
import { MAX_DEBUG_HISTORY } from "../constants";
import { isRouterPersistedState } from "../state/guards";
import type { RouterState } from "../state/create";
import type { CustomSessionEntry, RouterPersistedState } from "../types";
import { updateStatus } from "../ui";
import { SESSION_RESTORE_DELAY_MS } from "./constants";

export const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const extractSavedState = (entries: CustomSessionEntry[]): unknown =>
  entries
    .filter((entry) => entry.type === "custom" && entry.customType === "router-state")
    .map((entry) => entry.data)
    .findLast((data) => isRouterPersistedState(data));

export const applySavedState = (state: RouterState, savedState: RouterPersistedState): void => {
  state.selectedProfile = resolveProfileName(state.currentConfig, savedState.selectedProfile);
  state.routerEnabled = savedState.enabled;
  state.debugEnabled = savedState.debugEnabled ?? state.debugEnabled;
  state.debugHistory = savedState.debugHistory
    ? [...savedState.debugHistory].slice(-MAX_DEBUG_HISTORY)
    : [];
  state.lastNonRouterModel = savedState.lastNonRouterModel ?? state.lastNonRouterModel;
  state.accumulatedCost = savedState.accumulatedCost ?? 0;
  state.lastDecision = savedState.lastDecision;
};

export const restoreStateFromSession = async (
  ctx: ExtensionContext,
  state: RouterState,
  helpers: {
    setModelInternally: (m: NonNullable<ExtensionContext["model"]>) => Promise<boolean>;
    persistState: () => void;
  },
  actions: {
    reloadConfig: (ctx?: ExtensionContext, opts?: { preserveDebug?: boolean }) => void;
    ensureValidActiveRouterProfile: (ctx: ExtensionContext) => Promise<void>;
  },
): Promise<void> => {
  state.lastExtensionContext = ctx;
  state.currentModelRegistry = ctx.modelRegistry;
  state.currentCwd = ctx.cwd;
  actions.reloadConfig(ctx);
  await delay(SESSION_RESTORE_DELAY_MS);
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
  const savedState = extractSavedState(entries);
  if (isRouterPersistedState(savedState)) {
    applySavedState(state, savedState);
  }
  await actions.ensureValidActiveRouterProfile(ctx);
  if (state.routerEnabled && state.selectedProfile) {
    const routerModel = ctx.modelRegistry.find("router", state.selectedProfile);
    if (routerModel) {
      const success = await helpers.setModelInternally(routerModel);
      if (!success) {
        ctx.ui.notify(
          `Failed to restore router/${state.selectedProfile} after relaunch.`,
          "warning",
        );
        state.routerEnabled = false;
      }
    } else {
      ctx.ui.notify(
        `Unable to restore router/${state.selectedProfile}; model is unavailable.`,
        "warning",
      );
      state.routerEnabled = false;
      ctx.ui.setHiddenThinkingLabel?.();
    }
  } else {
    ctx.ui.setHiddenThinkingLabel?.();
  }
  helpers.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
};
