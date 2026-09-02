import type { RouterConfig, RoutingDecision } from "../types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type RouterState = {
  currentConfig: RouterConfig;
  currentModelRegistry: ExtensionContext["modelRegistry"] | undefined;
  currentCwd: string;
  lastDecision: RoutingDecision | undefined;
  debugEnabled: boolean;
  routerEnabled: boolean;
  selectedProfile: string | undefined;
  lastRegisteredModels: string;
  debugHistory: RoutingDecision[];
  lastNonRouterModel: string | undefined;
  accumulatedCost: number;
  lastExtensionContext: ExtensionContext | undefined;
  lastConfigWarnings: string[];
  lastPersistedSnapshot: string | undefined;
  isInitialized: boolean;
  isInternalModelSwitch: number;
  failedByChain: Map<string, Set<string>>;
};

export const createRouterState = (): RouterState => ({
  currentConfig: { profiles: {} },
  currentModelRegistry: undefined,
  currentCwd: process.cwd(),
  lastDecision: undefined,
  debugEnabled: false,
  routerEnabled: false,
  selectedProfile: undefined,
  lastRegisteredModels: "",
  debugHistory: [],
  lastNonRouterModel: undefined,
  accumulatedCost: 0,
  lastExtensionContext: undefined,
  lastConfigWarnings: [],
  lastPersistedSnapshot: undefined,
  isInitialized: false,
  isInternalModelSwitch: 0,
  failedByChain: new Map<string, Set<string>>(),
});
