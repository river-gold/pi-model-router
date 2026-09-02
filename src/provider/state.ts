import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RoutingDecision } from "../types";

export type RouterProviderState = {
  lastRegisteredModels: string;
  readonly currentConfig: RouterConfig;
  readonly currentModelRegistry: ExtensionContext["modelRegistry"] | undefined;
  readonly lastExtensionContext: ExtensionContext | undefined;
  selectedProfile: string | undefined;
  routerEnabled: boolean;
  lastDecision: RoutingDecision | undefined;
  accumulatedCost: number;
  readonly failedByChain: Map<string, Set<string>>;
};

export const createCommitMutex = () => {
  let commitMutex: Promise<void> = Promise.resolve();
  const withCommitMutex = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const prev = commitMutex;
    let release!: () => void;
    commitMutex = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return { withCommitMutex };
};
