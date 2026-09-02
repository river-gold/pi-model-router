import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAnyModel } from "../state";
import type { RouterState } from "../state";

export const createSetModelInternally = (pi: ExtensionAPI, state: RouterState) => {
  const fn = async (model: NonNullable<ExtensionContext["model"]>): Promise<boolean> => {
    state.isInternalModelSwitch++;
    try {
      return await pi.setModel(model);
    } catch {
      return false;
    } finally {
      state.isInternalModelSwitch--;
    }
  };
  return fn;
};

export const createTryFallbackByRef = (
  pi: ExtensionAPI,
  state: RouterState,
  setModelInternally: (model: NonNullable<ExtensionContext["model"]>) => Promise<boolean>,
) => {
  const fn = async (ctx: ExtensionContext, ref: string): Promise<boolean> => {
    const slashIndex = ref.indexOf("/");
    if (slashIndex === -1) return false;
    try {
      const m = ctx.modelRegistry.find(ref.slice(0, slashIndex), ref.slice(slashIndex + 1));
      if (m) return await setModelInternally(m as NonNullable<ExtensionContext["model"]>);
    } catch {
      // ignore
    }
    return false;
  };
  return fn;
};

export const createTryRestoreFallback = (
  state: RouterState,
  tryFallbackByRef: (ctx: ExtensionContext, ref: string) => Promise<boolean>,
  getAnyModelFn: typeof getAnyModel = getAnyModel,
) => {
  const fn = async (ctx: ExtensionContext): Promise<boolean> => {
    if (state.lastNonRouterModel && (await tryFallbackByRef(ctx, state.lastNonRouterModel)))
      return true;
    try {
      const anyModel = getAnyModelFn(ctx.modelRegistry);
      if (anyModel && (await tryFallbackByRef(ctx, `${anyModel.provider}/${anyModel.id}`)))
        return true;
    } catch {
      // ignore
    }
    return false;
  };
  return fn;
};

export const createEnsureValidActiveRouterProfile = (
  state: RouterState,
  tryRestoreFallback: (ctx: ExtensionContext) => Promise<boolean>,
) => {
  const fn = async (ctx: ExtensionContext): Promise<void> => {
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
    ctx.ui.notify(
      "Router disabled: no fallback model available. Select a model manually.",
      "warning",
    );
  };
  return fn;
};
