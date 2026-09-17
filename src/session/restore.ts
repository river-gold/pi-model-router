import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveRouterName } from "../config/router";
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
  state.selectedRouter = resolveRouterName(state.currentConfig, savedState.selectedRouter);
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
    ensureValidActiveRouter: (ctx: ExtensionContext) => Promise<void>;
  },
): Promise<void> => {
  state.lastExtensionContext = ctx;
  state.currentModelRegistry = ctx.modelRegistry;
  state.currentCwd = ctx.cwd;
  actions.reloadConfig(ctx);
  await delay(SESSION_RESTORE_DELAY_MS);
  state.routerEnabled = ctx.model?.provider === "router";
  state.selectedRouter =
    ctx.model?.provider === "router"
      ? resolveRouterName(state.currentConfig, ctx.model.id)
      : resolveRouterName(state.currentConfig, state.selectedRouter);
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
  await actions.ensureValidActiveRouter(ctx);
  if (state.routerEnabled && state.selectedRouter) {
    const routerModel = ctx.modelRegistry.find("router", state.selectedRouter);
    if (routerModel) {
      const success = await helpers.setModelInternally(routerModel);
      if (!success) {
        ctx.ui.notify(
          `Failed to restore router/${state.selectedRouter} after relaunch.`,
          "warning",
        );
        state.routerEnabled = false;
      }
    } else {
      ctx.ui.notify(
        `Unable to restore router/${state.selectedRouter}; model is unavailable.`,
        "warning",
      );
      state.routerEnabled = false;
      ctx.ui.setHiddenThinkingLabel?.();
    }
  } else {
    ctx.ui.setHiddenThinkingLabel?.();
  }
  helpers.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedRouter, state.lastDecision);
};
