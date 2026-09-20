import type { RouterConfig, Router } from "../types";
import { mergeTier } from "./tier";
import { mergeTierGuides } from "./tierGuides";

export const mergeConfig = (base: RouterConfig, override: Partial<RouterConfig>): RouterConfig => {
  const mergedRouters: Record<string, Router> = { ...base.routers };
  for (const [name, router] of Object.entries(override.routers ?? {})) {
    if (typeof router !== "object" || router === null || Array.isArray(router)) {
      continue;
    }
    const existing = mergedRouters[name];
    mergedRouters[name] = {
      models: router.models ?? existing?.models,
      max: mergeTier(existing?.max, router.max),
      xhigh: mergeTier(existing?.xhigh, router.xhigh),
      high: mergeTier(existing?.high, router.high),
      medium: mergeTier(existing?.medium, router.medium),
      low: mergeTier(existing?.low, router.low),
      minimal: mergeTier(existing?.minimal, router.minimal),
      classifierModels: router.classifierModels ?? existing?.classifierModels,
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
    routeEveryTurn:
      typeof override.routeEveryTurn === "boolean" ? override.routeEveryTurn : base.routeEveryTurn,
    tierGuides: mergeTierGuides(base.tierGuides, override.tierGuides),
    routers: mergedRouters,
  };
};
