import type { RouterConfig, RouterProfile } from "../types";
import { mergeTier } from "./tier";
import { mergeTierGuides } from "./tierGuides";

export const mergeConfig = (base: RouterConfig, override: Partial<RouterConfig>): RouterConfig => {
  const mergedProfiles: Record<string, RouterProfile> = { ...base.profiles };
  for (const [name, profile] of Object.entries(override.profiles ?? {})) {
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
      continue;
    }
    const existing = mergedProfiles[name];
    mergedProfiles[name] = {
      models: profile.models ?? existing?.models,
      max: mergeTier(existing?.max, profile.max),
      xhigh: mergeTier(existing?.xhigh, profile.xhigh),
      high: mergeTier(existing?.high, profile.high),
      medium: mergeTier(existing?.medium, profile.medium),
      low: mergeTier(existing?.low, profile.low),
      minimal: mergeTier(existing?.minimal, profile.minimal),
      classifierModels: profile.classifierModels ?? existing?.classifierModels,
    };
  }

  return {
    debug: override.debug ?? base.debug,
    classifierModels: override.classifierModels ?? base.classifierModels,
    typesafeConfidenceThreshold:
      override.typesafeConfidenceThreshold ?? base.typesafeConfidenceThreshold,
    historySize:
      typeof override.historySize === "number"
        ? override.historySize
        : typeof base.historySize === "number"
          ? base.historySize
          : undefined,
    tierGuides: mergeTierGuides(base.tierGuides, override.tierGuides),
    profiles: mergedProfiles,
  };
};
