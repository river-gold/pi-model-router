import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../commands";
import { createRouterState } from "../state";
import { updateStatus } from "../ui";
import { createRouterActions } from "./actions";
import { handleModelSelect, handleSessionStart, handleTurnEnd, handleTurnStart } from "./handlers";

export const createExtensionState = createRouterState;
export { handleSessionStart, handleModelSelect, handleTurnStart, handleTurnEnd };

const routerExtension = (pi: ExtensionAPI): void => {
  const state = createRouterState();
  const actions = createRouterActions(pi, state);
  actions.reloadConfig();

  registerCommands(
    pi,
    {
      get currentConfig() {
        return state.currentConfig;
      },
      get routerEnabled() {
        return state.routerEnabled;
      },
      set routerEnabled(v) {
        state.routerEnabled = v;
      },
      get selectedProfile() {
        return state.selectedProfile;
      },
      set selectedProfile(v) {
        state.selectedProfile = v;
      },
      get lastDecision() {
        return state.lastDecision;
      },
      get lastNonRouterModel() {
        return state.lastNonRouterModel;
      },
      set lastNonRouterModel(v) {
        state.lastNonRouterModel = v;
      },
      get accumulatedCost() {
        return state.accumulatedCost;
      },
      get debugEnabled() {
        return state.debugEnabled;
      },
      set debugEnabled(v) {
        state.debugEnabled = v;
      },
      get debugHistory() {
        return state.debugHistory;
      },
      set debugHistory(v) {
        state.debugHistory = v;
      },
      get lastConfigWarnings() {
        return state.lastConfigWarnings;
      },
      get failedByChain() {
        return state.failedByChain;
      },
    },
    {
      persistState: actions.persistState,
      updateStatus: (ctx) =>
        updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision),
      reloadConfig: actions.reloadConfig,
      ensureValidActiveRouterProfile: actions.ensureValidActiveRouterProfile,
    },
  );

  pi.on("session_start", (event, ctx) => handleSessionStart(event, ctx, state, actions));
  pi.on("turn_start", (event, ctx) => handleTurnStart(event, ctx, state, actions));
  pi.on("model_select", (event, ctx) => handleModelSelect(event as any, ctx, state, actions));
  pi.on("turn_end", (event, ctx) => handleTurnEnd(event, ctx, state, actions));
};

export default routerExtension;
