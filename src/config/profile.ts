import type { RouterConfig } from "../types";

export const profileNames = (config: RouterConfig): string[] => Object.keys(config.profiles).sort();

export const resolveProfileName = (
  config: RouterConfig,
  requested?: string,
): string | undefined => {
  if (requested && config.profiles[requested]) {
    return requested;
  }
  return undefined;
};
