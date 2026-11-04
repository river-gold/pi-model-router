import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadRouterConfig } from "../config";
import type { RouterState } from "../state";
import type { RoutingDecision } from "../types";
import { createVirtualModelRegistrar } from "../virtualModel";
import { MAX_DEBUG_HISTORY } from "../constants";

export const createReloadConfig = (pi: ExtensionAPI, state: RouterState) => {
  const register = createVirtualModelRegistrar(pi);
  const record = (decision: RoutingDecision): void => {
    state.lastDecision = decision;
    if (state.debugEnabled) {
      state.debugHistory = [...state.debugHistory, decision].slice(-MAX_DEBUG_HISTORY);
    }
  };
  return (ctx?: ExtensionContext, options?: { preserveDebug?: boolean }): void => {
    const loaded = loadRouterConfig(state.currentCwd);
    state.currentConfig = loaded.config;
    state.lastConfigWarnings = loaded.warnings;
    if (!options?.preserveDebug) state.debugEnabled = state.currentConfig.debug ?? false;
    register(state.currentConfig, ctx?.modelRegistry ?? state.currentModelRegistry, record);
    if (ctx && state.lastConfigWarnings.length > 0) {
      ctx.ui.notify(
        `Router Configuration Warnings:\n${state.lastConfigWarnings.join("\n")}`,
        "warning",
      );
    }
  };
};
