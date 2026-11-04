import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RoutingDecision } from "../types";

export type RouterState = {
  currentConfig: RouterConfig;
  currentCwd: string;
  currentModelRegistry: ExtensionContext["modelRegistry"] | undefined;
  lastExtensionContext: ExtensionContext | undefined;
  lastDecision: RoutingDecision | undefined;
  debugEnabled: boolean;
  debugHistory: RoutingDecision[];
  lastConfigWarnings: string[];
  fallbackCandidates: string[];
  fallbackFailures: Set<string>;
  fallbackPending: boolean;
};

export const createRouterState = (): RouterState => ({
  currentConfig: { routers: {} },
  currentCwd: process.cwd(),
  currentModelRegistry: undefined,
  lastExtensionContext: undefined,
  lastDecision: undefined,
  debugEnabled: false,
  debugHistory: [],
  lastConfigWarnings: [],
  fallbackCandidates: [],
  fallbackFailures: new Set(),
  fallbackPending: false,
});
