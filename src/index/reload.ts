import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadRouterConfig, routerNames, resolveRouterName } from "../config";
import { registerRouterProvider } from "../provider";
import { updateStatus } from "../ui";
import type { RouterState } from "../state";
import type { RoutingDecision } from "../types";

export type ReloadDeps = {
  loadRouterConfig: typeof loadRouterConfig;
  routerNames: typeof routerNames;
  resolveRouterName: typeof resolveRouterName;
  registerRouterProvider: typeof registerRouterProvider;
  updateStatus: typeof updateStatus;
};

export const createReloadConfig = (
  pi: ExtensionAPI,
  state: RouterState,
  persistState: () => void,
  recordDebugDecision: (d: RoutingDecision) => void,
  deps: ReloadDeps = {
    loadRouterConfig,
    routerNames,
    resolveRouterName,
    registerRouterProvider,
    updateStatus,
  },
) => {
  const fn = (ctx?: ExtensionContext, options?: { preserveDebug?: boolean }): void => {
    const loaded = deps.loadRouterConfig(state.currentCwd);
    state.currentConfig = loaded.config;
    state.lastConfigWarnings = loaded.warnings;
    if (!options?.preserveDebug) state.debugEnabled = state.currentConfig.debug ?? false;
    state.selectedRouter = deps.resolveRouterName(state.currentConfig, state.selectedRouter);
    deps.registerRouterProvider(
      pi,
      {
        get lastRegisteredModels() {
          return state.lastRegisteredModels;
        },
        set lastRegisteredModels(v) {
          state.lastRegisteredModels = v;
        },
        get currentConfig() {
          return state.currentConfig;
        },
        get currentModelRegistry() {
          return state.currentModelRegistry;
        },
        get lastExtensionContext() {
          return state.lastExtensionContext;
        },
        get selectedRouter() {
          return state.selectedRouter;
        },
        set selectedRouter(v) {
          state.selectedRouter = v;
        },
        get routerEnabled() {
          return state.routerEnabled;
        },
        set routerEnabled(v) {
          state.routerEnabled = v;
        },
        get lastDecision() {
          return state.lastDecision;
        },
        set lastDecision(v) {
          state.lastDecision = v;
        },
        get accumulatedCost() {
          return state.accumulatedCost;
        },
        set accumulatedCost(v) {
          state.accumulatedCost = v;
        },
        get failedByChain() {
          return state.failedByChain;
        },
      },
      {
        persistState,
        recordDebugDecision,
        updateStatus: (c) =>
          deps.updateStatus(c, state.routerEnabled, state.selectedRouter, state.lastDecision),
      },
    );
    if (ctx) {
      deps.updateStatus(ctx, state.routerEnabled, state.selectedRouter, state.lastDecision);
      if (state.lastConfigWarnings.length > 0)
        ctx.ui.notify(
          `Router Configuration Warnings:\n${state.lastConfigWarnings.join("\n")}`,
          "warning",
        );
    }
  };
  return fn;
};
