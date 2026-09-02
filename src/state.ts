/* oxlint-disable */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RouterPersistedState, RoutingDecision } from "./types";

export const isRouterPersistedState = (value: unknown): value is RouterPersistedState => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.selectedProfile === "string" &&
    typeof v.timestamp === "number"
  );
};

export const buildPersistedState = (
  routerEnabled: boolean,
  selectedProfile: string | undefined,
  debugEnabled: boolean,
  debugHistory: RoutingDecision[],
  lastDecision: RoutingDecision | undefined,
  lastNonRouterModel: string | undefined,
  accumulatedCost: number,
): RouterPersistedState => {
  return {
    enabled: routerEnabled,
    selectedProfile: selectedProfile ?? "",
    debugEnabled,
    debugHistory,
    lastDecision,
    lastNonRouterModel,
    accumulatedCost,
    timestamp: Date.now(),
  };
};

// Snapshot comparison helper for persist deduplication
export const isEqualPersistedState = (
  prevSnapshot: string | undefined,
  nextSnapshot: string,
): boolean => prevSnapshot === nextSnapshot;

// Extract any available model from registry via unknown-safe access
export const getAnyModel = (
  registry: ExtensionContext["modelRegistry"],
): { provider: string; id: string } | undefined => {
  try {
    const withList = registry as unknown as {
      list?: () => { provider: string; id: string }[];
    };
    const listed = withList.list?.()?.[0];
    if (listed) return listed;
  } catch {
    /* ignore */
  }
  try {
    const withModels = registry as unknown as {
      models?: { provider: string; id: string }[];
    };
    const m = withModels.models?.[0];
    if (m) return m;
  } catch {
    /* ignore */
  }
  return undefined;
};

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
