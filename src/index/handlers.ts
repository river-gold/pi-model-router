import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { routerNames, resolveRouterName } from "../config";
import { restoreStateFromSession } from "../session";
import { updateStatus } from "../ui";
import type { RouterState } from "../state";
import type { createRouterActions } from "./actions";

export const handleSessionStart = async (
  _event: unknown,
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): Promise<void> => {
  state.isInitialized = true;
  const helpers = {
    setModelInternally: actions.setModelInternally,
    persistState: actions.persistState,
  };
  await restoreStateFromSession(ctx, state, helpers, {
    reloadConfig: actions.reloadConfig,
    ensureValidActiveRouter: actions.ensureValidActiveRouter,
  });
  if (state.debugEnabled)
    ctx.ui.notify(
      `Router initialized with routers: ${routerNames(state.currentConfig).join(", ")}`,
      "info",
    );
};

export const handleModelSelect = async (
  event: { model: NonNullable<ExtensionContext["model"]> },
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): Promise<void> => {
  if (!state.isInitialized || state.isInternalModelSwitch > 0) return;
  if (event.model.provider === "router") {
    const routerName = resolveRouterName(state.currentConfig, event.model.id);
    if (!routerName) {
      ctx.ui.notify(`Unknown router router: ${event.model.id}`, "error");
      state.routerEnabled = false;
      state.selectedRouter = undefined;
      if (await actions.tryRestoreFallback(ctx)) return;
      ctx.ui.notify(
        "Router disabled: no fallback model available. Select a model manually.",
        "warning",
      );
      return;
    }
    const registryModel = ctx.modelRegistry.find("router", routerName);
    if (
      registryModel &&
      (registryModel.contextWindow !== event.model.contextWindow ||
        registryModel.maxTokens !== event.model.maxTokens)
    ) {
      await actions.setModelInternally(registryModel);
    }
    state.routerEnabled = true;
    state.selectedRouter = routerName;
  } else {
    state.routerEnabled = false;
    state.lastNonRouterModel = `${event.model.provider}/${event.model.id}`;
    ctx.ui.setHiddenThinkingLabel?.();
  }
  actions.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedRouter, state.lastDecision);
};

export const handleTurnStart = (
  _event: unknown,
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): void => {
  if (!state.currentModelRegistry) {
    state.currentModelRegistry = ctx.modelRegistry;
    state.lastExtensionContext = ctx;
    state.currentCwd = ctx.cwd;
    actions.reloadConfig(ctx);
  }
};

export const handleTurnEnd = async (
  _event: unknown,
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): Promise<void> => {
  if (!state.currentModelRegistry) {
    state.currentModelRegistry = ctx.modelRegistry;
    state.lastExtensionContext = ctx;
    state.currentCwd = ctx.cwd;
    actions.reloadConfig(ctx);
  }
  if (state.routerEnabled && state.selectedRouter && ctx.model?.provider !== "router") {
    const routerModel = ctx.modelRegistry.find("router", state.selectedRouter);
    if (routerModel) await actions.setModelInternally(routerModel);
  }
  actions.persistState();
  updateStatus(ctx, state.routerEnabled, state.selectedRouter, state.lastDecision);
};
