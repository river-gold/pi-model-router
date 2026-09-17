import type { RouterConfig } from "../types";

export const routerNames = (config: RouterConfig): string[] => Object.keys(config.routers).sort();

export const resolveRouterName = (
  config: RouterConfig,
  requested?: string,
): string | undefined => {
  if (requested && config.routers[requested]) {
    return requested;
  }
  return undefined;
};
