/* oxlint-disable */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./src/commands";
import { loadRouterConfig, profileNames, resolveProfileName } from "./src/config";
import { MAX_DEBUG_HISTORY } from "./src/constants";
import { registerRouterProvider } from "./src/provider";
import { buildPersistedState, isRouterPersistedState } from "./src/state";
import type { CustomSessionEntry, RouterConfig, RoutingDecision } from "./src/types";
import { updateStatus } from "./src/ui";

const routerExtension = (pi: ExtensionAPI) => {
  let currentConfig: RouterConfig = { profiles: {} };
  let currentModelRegistry: ExtensionContext["modelRegistry"] | undefined;
  let currentCwd = process.cwd();
  let lastDecision: RoutingDecision | undefined;
  let debugEnabled = false;
  let routerEnabled = false;
  let selectedProfile: string | undefined;
  let lastRegisteredModels = "";
  let debugHistory: RoutingDecision[] = [];
  let lastNonRouterModel: string | undefined;
  let accumulatedCost = 0;
  let lastExtensionContext: ExtensionContext | undefined;
  let lastConfigWarnings: string[] = [];
  let lastPersistedSnapshot: string | undefined;
  let isInitialized = false;
  let isInternalModelSwitch = 0;
  const failedByChain = new Map<string, Set<string>>();
  // Delay to allow pi internal registry/session initialization to settle
  // before reading model registry and session branch. Keep small and
  // explicit; consider replacing with deterministic readiness signal
  // (e.g. waitForRegistry) if the race reappears.
  const SESSION_RESTORE_DELAY_MS = 50;

  const setModelInternally = async (model: NonNullable<ExtensionContext["model"]>) => {
    isInternalModelSwitch++;
    try {
      return await pi.setModel(model);
    } catch {
      return false;
    } finally {
      isInternalModelSwitch--;
    }
  };

  const tryFallbackByRef = async (ctx: ExtensionContext, ref: string): Promise<boolean> => {
    const slashIndex = ref.indexOf("/");
    if (slashIndex === -1) return false;
    try {
      const m = ctx.modelRegistry.find(ref.slice(0, slashIndex), ref.slice(slashIndex + 1));
      if (m) return await setModelInternally(m);
    } catch {
      /* ignore */
    }
    return false;
  };

  /* v8 ignore start */
  const tryRestoreFallback = async (ctx: ExtensionContext): Promise<boolean> => {
    if (lastNonRouterModel && (await tryFallbackByRef(ctx, lastNonRouterModel))) return true;
    try {
      const anyModel =
        (
          ctx.modelRegistry as unknown as {
            list?: () => { provider: string; id: string }[];
          }
        ).list?.()?.[0] ??
        (
          ctx.modelRegistry as unknown as {
            models?: { provider: string; id: string }[];
          }
        ).models?.[0];
      if (anyModel && (await tryFallbackByRef(ctx, `${anyModel.provider}/${anyModel.id}`)))
        return true;
    } catch {
      /* ignore */
    }
    return false;
  };
  /* v8 ignore stop */

  const recordDebugDecision = (decision: RoutingDecision) => {
    debugHistory = [...debugHistory, decision].slice(-MAX_DEBUG_HISTORY);
  };

  const persistState = () => {
    const state = buildPersistedState(
      routerEnabled,
      selectedProfile,
      debugEnabled,
      debugHistory,
      lastDecision,
      lastNonRouterModel,
      accumulatedCost,
    );
    const snapshot = JSON.stringify({
      ...state,
      timestamp: 0,
      lastDecision: state.lastDecision ? { ...state.lastDecision, timestamp: 0 } : undefined,
      /* v8 ignore next */
      debugHistory: state.debugHistory?.map((decision) => ({
        ...decision,
        timestamp: 0,
      })),
    });
    if (snapshot === lastPersistedSnapshot) {
      return;
    }
    try {
      pi.appendEntry("router-state", state);
    } catch {
      return;
    }
    lastPersistedSnapshot = snapshot;
  };

  const actions = {
    persistState,
    updateStatus: (ctx: ExtensionContext) =>
      updateStatus(ctx, routerEnabled, selectedProfile, lastDecision),
    reloadConfig: (ctx?: ExtensionContext, options?: { preserveDebug?: boolean }) => {
      const loaded = loadRouterConfig(currentCwd);
      currentConfig = loaded.config;
      lastConfigWarnings = loaded.warnings;
      /* v8 ignore next */
      if (!options?.preserveDebug) {
        debugEnabled = currentConfig.debug ?? false;
      }
      selectedProfile = resolveProfileName(currentConfig, selectedProfile);
      actions.registerRouterProvider();
      if (ctx) {
        actions.updateStatus(ctx);
        if (lastConfigWarnings.length > 0) {
          ctx.ui.notify(
            `Router Configuration Warnings:\n${lastConfigWarnings.join("\n")}`,
            "warning",
          );
        }
      }
    },
    ensureValidActiveRouterProfile: async (ctx: ExtensionContext) => {
      if (ctx.model?.provider !== "router") {
        return;
      }
      if (currentConfig.profiles[ctx.model.id]) {
        selectedProfile = ctx.model.id;
        routerEnabled = true;
        return;
      }
      ctx.ui.notify(`Router profile "${ctx.model.id}" is no longer configured.`, "warning");
      routerEnabled = false;
      selectedProfile = undefined;
      if (await tryRestoreFallback(ctx)) return;
      ctx.ui.notify(
        "Router disabled: no fallback model available. Select a model manually.",
        "warning",
      );
    },
    registerRouterProvider: () => {
      registerRouterProvider(
        pi,
        {
          /* v8 ignore start */
          get lastRegisteredModels() {
            return lastRegisteredModels;
          },
          set lastRegisteredModels(v) {
            lastRegisteredModels = v;
          },
          get currentConfig() {
            return currentConfig;
          },
          get currentModelRegistry() {
            return currentModelRegistry;
          },
          get lastExtensionContext() {
            return lastExtensionContext;
          },
          get selectedProfile() {
            return selectedProfile;
          },
          set selectedProfile(v) {
            selectedProfile = v;
          },
          get routerEnabled() {
            return routerEnabled;
          },
          set routerEnabled(v) {
            routerEnabled = v;
          },
          get lastDecision() {
            return lastDecision;
          },
          set lastDecision(v) {
            lastDecision = v;
          },
          get accumulatedCost() {
            return accumulatedCost;
          },
          set accumulatedCost(v) {
            accumulatedCost = v;
          },
          get failedByChain() {
            return failedByChain;
          },
          /* v8 ignore stop */
        },
        {
          persistState,
          recordDebugDecision,
          updateStatus: actions.updateStatus,
        },
      );
    },
  };

  actions.reloadConfig();

  const restoreStateFromSession = async (ctx: ExtensionContext) => {
    lastExtensionContext = ctx;
    currentModelRegistry = ctx.modelRegistry;
    currentCwd = ctx.cwd;
    actions.reloadConfig(ctx);
    await new Promise((resolve) => setTimeout(resolve, SESSION_RESTORE_DELAY_MS));
    routerEnabled = ctx.model?.provider === "router";
    selectedProfile =
      ctx.model?.provider === "router"
        ? resolveProfileName(currentConfig, ctx.model.id)
        : resolveProfileName(currentConfig, selectedProfile);
    debugHistory = [];
    accumulatedCost = 0;
    lastNonRouterModel =
      ctx.model && ctx.model.provider !== "router"
        ? `${ctx.model.provider}/${ctx.model.id}`
        : lastNonRouterModel;
    lastDecision = undefined;
    const entries = ctx.sessionManager.getBranch() as CustomSessionEntry[];
    const savedState = entries
      .filter((entry) => entry.type === "custom" && entry.customType === "router-state")
      .map((entry) => entry.data)
      .findLast((data) => isRouterPersistedState(data));
    if (isRouterPersistedState(savedState)) {
      selectedProfile = resolveProfileName(currentConfig, savedState.selectedProfile);
      routerEnabled = savedState.enabled;
      debugEnabled = savedState.debugEnabled ?? debugEnabled;
      /* v8 ignore next */
      debugHistory = savedState.debugHistory
        ? [...savedState.debugHistory].slice(-MAX_DEBUG_HISTORY)
        : [];
      lastNonRouterModel = savedState.lastNonRouterModel ?? lastNonRouterModel;
      accumulatedCost = savedState.accumulatedCost ?? 0;
      lastDecision = savedState.lastDecision;
    }
    await actions.ensureValidActiveRouterProfile(ctx);
    if (routerEnabled && selectedProfile) {
      const routerModel = ctx.modelRegistry.find("router", selectedProfile);
      if (routerModel) {
        const success = await setModelInternally(routerModel);
        if (!success) {
          ctx.ui.notify(`Failed to restore router/${selectedProfile} after relaunch.`, "warning");
          routerEnabled = false;
        }
      } else {
        ctx.ui.notify(
          `Unable to restore router/${selectedProfile}; model is unavailable.`,
          "warning",
        );
        routerEnabled = false;
        ctx.ui.setHiddenThinkingLabel?.();
      }
    } else {
      ctx.ui.setHiddenThinkingLabel?.();
    }
    persistState();
    actions.updateStatus(ctx);
  };

  registerCommands(
    pi,
    {
      /* v8 ignore start */
      get currentConfig() {
        return currentConfig;
      },
      get routerEnabled() {
        return routerEnabled;
      },
      set routerEnabled(v) {
        routerEnabled = v;
      },
      get selectedProfile() {
        return selectedProfile;
      },
      set selectedProfile(v) {
        selectedProfile = v;
      },
      get lastDecision() {
        return lastDecision;
      },
      get lastNonRouterModel() {
        return lastNonRouterModel;
      },
      set lastNonRouterModel(v) {
        lastNonRouterModel = v;
      },
      get accumulatedCost() {
        return accumulatedCost;
      },
      get debugEnabled() {
        return debugEnabled;
      },
      set debugEnabled(v) {
        debugEnabled = v;
      },
      get debugHistory() {
        return debugHistory;
      },
      set debugHistory(v) {
        debugHistory = v;
      },
      get lastConfigWarnings() {
        return lastConfigWarnings;
      },
      get failedByChain() {
        return failedByChain;
      },
      /* v8 ignore stop */
    },
    actions,
  );

  pi.on("session_start", async (_event, ctx) => {
    isInitialized = true;
    await restoreStateFromSession(ctx);
    if (debugEnabled) {
      ctx.ui.notify(
        `Router initialized with profiles: ${profileNames(currentConfig).join(", ")}`,
        "info",
      );
    }
  });

  const ensureInitializedFromContext = (ctx: ExtensionContext) => {
    if (!currentModelRegistry) {
      currentModelRegistry = ctx.modelRegistry;
      lastExtensionContext = ctx;
      currentCwd = ctx.cwd;
      actions.reloadConfig(ctx);
    }
  };

  pi.on("turn_start", async (_event, ctx) => {
    ensureInitializedFromContext(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    ensureInitializedFromContext(ctx);
    if (!isInitialized || isInternalModelSwitch > 0) return;
    if (event.model.provider === "router") {
      const profileName = resolveProfileName(currentConfig, event.model.id);
      if (!profileName) {
        ctx.ui.notify(`Unknown router profile: ${event.model.id}`, "error");
        routerEnabled = false;
        selectedProfile = undefined;
        if (await tryRestoreFallback(ctx)) return;
        ctx.ui.notify(
          "Router disabled: no fallback model available. Select a model manually.",
          "warning",
        );
        return;
      }
      const registryModel = ctx.modelRegistry.find("router", profileName);
      if (
        registryModel &&
        (registryModel.contextWindow !== event.model.contextWindow ||
          registryModel.maxTokens !== event.model.maxTokens)
      ) {
        await setModelInternally(registryModel);
      }
      routerEnabled = true;
      selectedProfile = profileName;
    } else {
      routerEnabled = false;
      lastNonRouterModel = `${event.model.provider}/${event.model.id}`;
      ctx.ui.setHiddenThinkingLabel?.();
    }
    persistState();
    actions.updateStatus(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    ensureInitializedFromContext(ctx);
    if (routerEnabled && selectedProfile && ctx.model?.provider !== "router") {
      const routerModel = ctx.modelRegistry.find("router", selectedProfile);
      /* v8 ignore next */
      if (routerModel) {
        await setModelInternally(routerModel);
      }
    }
    persistState();
    actions.updateStatus(ctx);
  });

  // Note: pi-agent-core does not emit a 'session_tree' event. Branch navigation
  // (fork/resume) reuses session_start with reason 'fork'/'resume', which already
  // restores the correct branch state via the handler above. No separate
  // session_tree handler is needed; a stale handler would be dead code.
};

export default routerExtension;
