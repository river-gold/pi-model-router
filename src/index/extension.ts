import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../commands";
import { createRouterState } from "../state";
import { createRouterActions } from "./actions";
import { handleSessionStart } from "./handlers";
import { recoverFallback } from "./recovery";

export const createExtensionState = createRouterState;

const routerExtension = (pi: ExtensionAPI): void => {
  const state = createRouterState();
  const actions = createRouterActions(pi, state);
  actions.reloadConfig();
  registerCommands(pi, state, actions);
  pi.on("session_start", (event, ctx) => {
    state.fallbackFailures.clear();
    state.fallbackPending = false;
    handleSessionStart(event, ctx, state, actions);
  });
  pi.on("agent_before_settle", (event, ctx) => recoverFallback(event, ctx, state));
  pi.on("agent_settled", () => {
    state.fallbackFailures.clear();
    state.fallbackPending = false;
  });
};

export default routerExtension;
