import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterState } from "../state";
import type { createRouterActions } from "./actions";

export const handleSessionStart = (
  _event: unknown,
  ctx: ExtensionContext,
  state: RouterState,
  actions: ReturnType<typeof createRouterActions>,
): void => {
  state.lastExtensionContext = ctx;
  state.currentCwd = ctx.cwd;
  state.currentModelRegistry = ctx.modelRegistry;
  // 세션 시점에는 modelRegistry가 있으므로 limit 해석을 포함해 다시 등록한다.
  actions.reloadConfig(ctx);
};
