import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RouterState } from "../state";
import { createReloadConfig } from "./reload";

export const createRouterActions = (pi: ExtensionAPI, state: RouterState) => ({
  reloadConfig: createReloadConfig(pi, state),
});
