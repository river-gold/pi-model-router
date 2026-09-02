/* oxlint-disable */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands";
import { loadRouterConfig, profileNames, resolveProfileName } from "./config";
import { MAX_DEBUG_HISTORY } from "./constants";
import { registerRouterProvider } from "./provider";
import { buildPersistedState, createRouterState, getAnyModel, isEqualPersistedState } from "./state";
import type { RouterState } from "./state";
import { restoreStateFromSession, SESSION_RESTORE_DELAY_MS } from "./session";
import { updateStatus } from "./ui";

export const createRouterActions = (pi: ExtensionAPI, state: RouterState) => {
  const recordDebugDecision: (d: import("./types").RoutingDecision) => void = (decision) => {
    state.debugHistory = [...state.debugHistory, decision].slice(-MAX_DEBUG_HISTORY);
  };

  const persistState = (): void => {
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
      pi.appendEntry("router-state", buildPersistedState(
        state.routerEnabled,
        state.selectedProfile,
        state.debugEnabled,
        state.debugHistory,
        state.lastDecision,
        state.lastNonRouterModel,
        state.accumulatedCost,
      ));
    } catch {
      return;
    }
    state.lastPersistedSnapshot = snapshot;
  };

  const reloadConfig = (ctx?: ExtensionContext, options?: { preserveDebug?: boolean }): void => {
    const loaded = loadRouterConfig(state.currentCwd);
    state.currentConfig = loaded.config;
    state.lastConfigWarnings = loaded.warnings;
    if (!options?.preserveDebug) state.debugEnabled = state.currentConfig.debug ?? false;
    state.selectedProfile = resolveProfileName(state.currentConfig, state.selectedProfile);
    registerRouterProvider(
      pi,
      {
        get lastRegisteredModels() { return state.lastRegisteredModels; },
        set lastRegisteredModels(v) { state.lastRegisteredModels = v; },
        get currentConfig() { return state.currentConfig; },
        get currentModelRegistry() { return state.currentModelRegistry; },
        get lastExtensionContext() { return state.lastExtensionContext; },
        get selectedProfile() { return state.selectedProfile; },
        set selectedProfile(v) { state.selectedProfile = v; },
        get routerEnabled() { return state.routerEnabled; },
        set routerEnabled(v) { state.routerEnabled = v; },
        get lastDecision() { return state.lastDecision; },
        set lastDecision(v) { state.lastDecision = v; },
        get accumulatedCost() { return state.accumulatedCost; },
        set accumulatedCost(v) { state.accumulatedCost = v; },
        get failedByChain() { return state.failedByChain; },
      },
      { persistState, recordDebugDecision, updateStatus: (c) => updateStatus(c, state.routerEnabled, state.selectedProfile, state.lastDecision) },
    );
    if (ctx) {
      updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
      if (state.lastConfigWarnings.length > 0) ctx.ui.notify(`Router Configuration Warnings:\n${state.lastConfigWarnings.join("\n")}`, "warning");
    }
  };

  const setModelInternally = async (model: NonNullable<ExtensionContext["model"]>): Promise<boolean> => {
    state.isInternalModelSwitch++;
    try { return await pi.setModel(model); } catch { return false; } finally { state.isInternalModelSwitch--; }
  };

  const tryFallbackByRef = async (ctx: ExtensionContext, ref: string): Promise<boolean> => {
    const slashIndex = ref.indexOf("/");
    if (slashIndex === -1) return false;
    try {
      const m = ctx.modelRegistry.find(ref.slice(0, slashIndex), ref.slice(slashIndex + 1));
      if (m) return await setModelInternally(m);
    } catch { /* ignore */ }
    return false;
  };

  const tryRestoreFallback = async (ctx: ExtensionContext): Promise<boolean> => {
    if (state.lastNonRouterModel && (await tryFallbackByRef(ctx, state.lastNonRouterModel))) return true;
    try {
      const anyModel = getAnyModel(ctx.modelRegistry);
      if (anyModel && (await tryFallbackByRef(ctx, `${anyModel.provider}/${anyModel.id}`))) return true;
    } catch { /* ignore */ }
    return false;
  };

  const ensureValidActiveRouterProfile = async (ctx: ExtensionContext): Promise<void> => {
    if (ctx.model?.provider !== "router") return;
    if (ctx.model.id && state.currentConfig.profiles[ctx.model.id]) {
      state.selectedProfile = ctx.model.id;
      state.routerEnabled = true;
      return;
    }
    ctx.ui.notify(`Router profile "${ctx.model.id}" is no longer configured.`, "warning");
    state.routerEnabled = false;
    state.selectedProfile = undefined;
    if (await tryRestoreFallback(ctx)) return;
    ctx.ui.notify("Router disabled: no fallback model available. Select a model manually.", "warning");
  };

  // registerRouterProvider wrapper for external use
  const registerRouterProviderAction = (): void => {
    registerRouterProvider(
      pi,
      {
        get lastRegisteredModels() { return state.lastRegisteredModels; },
        set lastRegisteredModels(v) { state.lastRegisteredModels = v; },
        get currentConfig() { return state.currentConfig; },
        get currentModelRegistry() { return state.currentModelRegistry; },
        get lastExtensionContext() { return state.lastExtensionContext; },
        get selectedProfile() { return state.selectedProfile; },
        set selectedProfile(v) { state.selectedProfile = v; },
        get routerEnabled() { return state.routerEnabled; },
        set routerEnabled(v) { state.routerEnabled = v; },
        get lastDecision() { return state.lastDecision; },
        set lastDecision(v) { state.lastDecision = v; },
        get accumulatedCost() { return state.accumulatedCost; },
        set accumulatedCost(v) { state.accumulatedCost = v; },
        get failedByChain() { return state.failedByChain; },
      },
      { persistState, recordDebugDecision, updateStatus: (c) => updateStatus(c, state.routerEnabled, state.selectedProfile, state.lastDecision) },
    );
  };

  return { persistState, recordDebugDecision, reloadConfig, ensureValidActiveRouterProfile, registerRouterProvider: registerRouterProviderAction, setModelInternally, tryFallbackByRef, tryRestoreFallback };
};

export const handleSessionStart = async (
  _event: unknown,
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): Promise<void> => {
  state.isInitialized = true;
  // delegate to session restore
  const helpers = { setModelInternally: actions.setModelInternally, persistState: actions.persistState };
  await restoreStateFromSession(ctx, state, helpers, { reloadConfig: actions.reloadConfig, ensureValidActiveRouterProfile: actions.ensureValidActiveRouterProfile });
  if (state.debugEnabled) ctx.ui.notify(`Router initialized with profiles: ${profileNames(state.currentConfig).join(", ")}`, "info");
};

export const handleModelSelect = async (
  event: { model: NonNullable<ExtensionContext["model"]> },
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): Promise<void> => {
  if (!state.isInitialized || state.isInternalModelSwitch > 0) return;
  if (event.model.provider === "router") {
    const profileName = resolveProfileName(state.currentConfig, event.model.id);
    if (!profileName) {
      ctx.ui.notify(`Unknown router profile: ${event.model.id}`, "error");
      state.routerEnabled = false;
      state.selectedProfile = undefined;
      if (await actions.tryRestoreFallback(ctx)) return;
      ctx.ui.notify("Router disabled: no fallback model available. Select a model manually.", "warning");
      return;
    }
    const registryModel = ctx.modelRegistry.find("router", profileName);
    if (registryModel && (registryModel.contextWindow !== event.model.contextWindow || registryModel.maxTokens !== event.model.maxTokens)) {
      await actions.setModelInternally(registryModel);
    }
    state.routerEnabled = true;
    state.selectedProfile = profileName;
  } else {
    state.routerEnabled = false;
    state.lastNonRouterModel = `${event.model.provider}/${event.model.id}`;
    ctx.ui.setHiddenThinkingLabel?.();
  }
  actions.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
};

export const handleTurnStart = (_event: unknown, ctx: ExtensionContext, state: RouterState, actions: ReturnType<typeof createRouterActions>): void => {
  if (!state.currentModelRegistry) {
    state.currentModelRegistry = ctx.modelRegistry;
    state.lastExtensionContext = ctx;
    state.currentCwd = ctx.cwd;
    actions.reloadConfig(ctx);
  }
};

export const handleTurnEnd = async (_event: unknown, ctx: ExtensionContext, state: RouterState, actions: ReturnType<typeof createRouterActions>): Promise<void> => {
  if (!state.currentModelRegistry) {
    state.currentModelRegistry = ctx.modelRegistry;
    state.lastExtensionContext = ctx;
    state.currentCwd = ctx.cwd;
    actions.reloadConfig(ctx);
  }
  if (state.routerEnabled && state.selectedProfile && ctx.model?.provider !== "router") {
    const routerModel = ctx.modelRegistry.find("router", state.selectedProfile);
    if (routerModel) await actions.setModelInternally(routerModel);
  }
  actions.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
};

const routerExtension = (pi: ExtensionAPI): void => {
  const state = createRouterState();
  const actions = createRouterActions(pi, state);
  actions.reloadConfig();

  // ensure session restore uses actions
  const sessionHelpers = { setModelInternally: actions.setModelInternally, persistState: actions.persistState };

  const ensureInitializedFromContext = (ctx: ExtensionContext): void => {
    if (!state.currentModelRegistry) {
      state.currentModelRegistry = ctx.modelRegistry;
      state.lastExtensionContext = ctx;
      state.currentCwd = ctx.cwd;
      actions.reloadConfig(ctx);
    }
  };

  registerCommands(
    pi,
    {
      get currentConfig() { return state.currentConfig; },
      get routerEnabled() { return state.routerEnabled; },
      set routerEnabled(v) { state.routerEnabled = v; },
      get selectedProfile() { return state.selectedProfile; },
      set selectedProfile(v) { state.selectedProfile = v; },
      get lastDecision() { return state.lastDecision; },
      get lastNonRouterModel() { return state.lastNonRouterModel; },
      set lastNonRouterModel(v) { state.lastNonRouterModel = v; },
      get accumulatedCost() { return state.accumulatedCost; },
      get debugEnabled() { return state.debugEnabled; },
      set debugEnabled(v) { state.debugEnabled = v; },
      get debugHistory() { return state.debugHistory; },
      set debugHistory(v) { state.debugHistory = v; },
      get lastConfigWarnings() { return state.lastConfigWarnings; },
      get failedByChain() { return state.failedByChain; },
    },
    {
      persistState: actions.persistState,
      updateStatus: (ctx) => updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision),
      reloadConfig: actions.reloadConfig,
      ensureValidActiveRouterProfile: actions.ensureValidActiveRouterProfile,
    },
  );

  pi.on("session_start", async (event, ctx) => {
    state.isInitialized = true;
    await restoreStateFromSession(ctx, state, sessionHelpers, { reloadConfig: actions.reloadConfig, ensureValidActiveRouterProfile: actions.ensureValidActiveRouterProfile });
    if (state.debugEnabled) ctx.ui.notify(`Router initialized with profiles: ${profileNames(state.currentConfig).join(", ")}`, "info");
  });

  pi.on("turn_start", async (_event, ctx) => {
    ensureInitializedFromContext(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    ensureInitializedFromContext(ctx);
    if (!state.isInitialized || state.isInternalModelSwitch > 0) return;
    if ((event as { model: NonNullable<ExtensionContext["model"]> }).model.provider === "router") {
      const profileName = resolveProfileName(state.currentConfig, (event as { model: { id: string } }).model.id);
      if (!profileName) {
        ctx.ui.notify(`Unknown router profile: ${(event as { model: { id: string } }).model.id}`, "error");
        state.routerEnabled = false;
        state.selectedProfile = undefined;
        if (await actions.tryRestoreFallback(ctx)) return;
        ctx.ui.notify("Router disabled: no fallback model available. Select a model manually.", "warning");
        return;
      }
      const registryModel = ctx.modelRegistry.find("router", profileName);
      const evModel = (event as { model: { id: string; contextWindow?: number; maxTokens?: number; provider: string } }).model;
      if (registryModel && (registryModel.contextWindow !== evModel.contextWindow || registryModel.maxTokens !== evModel.maxTokens)) {
        await actions.setModelInternally(registryModel);
      }
      state.routerEnabled = true;
      state.selectedProfile = profileName;
    } else {
      const evModel = (event as { model: { id: string; provider: string } }).model;
      state.routerEnabled = false;
      state.lastNonRouterModel = `${evModel.provider}/${evModel.id}`;
      ctx.ui.setHiddenThinkingLabel?.();
    }
    actions.persistState();
    updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
  });

  pi.on("turn_end", async (_event, ctx) => {
    ensureInitializedFromContext(ctx);
    if (state.routerEnabled && state.selectedProfile && ctx.model?.provider !== "router") {
      const routerModel = ctx.modelRegistry.find("router", state.selectedProfile);
      if (routerModel) await actions.setModelInternally(routerModel);
    }
    actions.persistState();
    updateStatus(ctx, state.routerEnabled, state.selectedProfile, state.lastDecision);
  });
};

export default routerExtension;

// re-export helpers for testing
export { SESSION_RESTORE_DELAY_MS };
