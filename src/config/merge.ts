import type { RouterConfig, RouterProfile } from "../types";
import { isObjectRecord } from "./guards";
import { mergeTier } from "./tier";
import type { ClassifierConfig } from "../types";

export const mergeConfig = (base: RouterConfig, override: Partial<RouterConfig>): RouterConfig => {
  const mergedProfiles: Record<string, RouterProfile> = { ...base.profiles };
  for (const [name, profile] of Object.entries(override.profiles ?? {})) {
    if (!isObjectRecord(profile)) {
      continue;
    }
    const existing = mergedProfiles[name];
    const nextProfile = profile as Partial<RouterProfile>;
    mergedProfiles[name] = {
      max: mergeTier(existing?.max, nextProfile.max),
      xhigh: mergeTier(existing?.xhigh, nextProfile.xhigh),
      high: mergeTier(existing?.high, nextProfile.high),
      medium: mergeTier(existing?.medium, nextProfile.medium),
      low: mergeTier(existing?.low, nextProfile.low),
      minimal: mergeTier(existing?.minimal, nextProfile.minimal),
      classifierModels:
        (nextProfile.classifierModels as ClassifierConfig[] | undefined) ??
        existing?.classifierModels,
    };
  }

  const rawOverride = override as unknown as Record<string, unknown>;
  const rawBase = base as unknown as Record<string, unknown>;

  return {
    debug: override.debug ?? base.debug,
    classifierModels: override.classifierModels ?? base.classifierModels,
    historySize:
      rawOverride.historySize !== undefined
        ? (rawOverride.historySize as number)
        : (rawBase.historySize as number),
    profiles: mergedProfiles,
  };
};
