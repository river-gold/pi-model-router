import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RouterState } from "../state";
import { createPersistState, createRecordDebugDecision } from "./persist";
import { createReloadConfig } from "./reload";
import {
  createEnsureValidActiveRouterProfile,
  createSetModelInternally,
  createTryFallbackByRef,
  createTryRestoreFallback,
} from "./fallback";
import { registerRouterProvider } from "../provider";
import { updateStatus } from "../ui";

export const createRouterActions = (pi: ExtensionAPI, state: RouterState) => {
  const recordDebugDecision = createRecordDebugDecision(state);
  const persistState = createPersistState(pi, state);
  const setModelInternally = createSetModelInternally(pi, state);
  const tryFallbackByRef = createTryFallbackByRef(pi, state, setModelInternally);
  const tryRestoreFallback = createTryRestoreFallback(state, tryFallbackByRef);
  const ensureValidActiveRouterProfile = createEnsureValidActiveRouterProfile(state, tryRestoreFallback);
  const reloadConfig = createReloadConfig(pi, state, persistState, recordDebugDecision);

  const registerRouterProviderAction = (): void => {
    registerRouterProvider(
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
        get selectedProfile() {
          return state.selectedProfile;
        },
        set selectedProfile(v) {
          state.selectedProfile = v;
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
        updateStatus: (c) => updateStatus(c, state.routerEnabled, state.selectedProfile, state.lastDecision),
      },
    );
  };

  return {
    persistState,
    recordDebugDecision,
    reloadConfig,
    ensureValidActiveRouterProfile,
    registerRouterProvider: registerRouterProviderAction,
    setModelInternally,
    tryFallbackByRef,
    tryRestoreFallback,
  };
};
