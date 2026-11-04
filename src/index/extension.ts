import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../commands";
import { createRouterState } from "../state";
import { createRouterActions } from "./actions";
import { handleSessionStart } from "./handlers";

export const createExtensionState = createRouterState;

const routerExtension = (pi: ExtensionAPI): void => {
  const state = createRouterState();
  const actions = createRouterActions(pi, state);
  actions.reloadConfig();
  registerCommands(pi, state, actions);
  pi.on("session_start", (event, ctx) => handleSessionStart(event, ctx, state, actions));
};

export default routerExtension;
