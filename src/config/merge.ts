import type { RouterConfig, Router } from "../types";
import { mergeTier } from "./tier";

export const mergeConfig = (base: RouterConfig, override: Partial<RouterConfig>): RouterConfig => {
  const mergedRouters: Record<string, Router> = { ...base.routers };
  for (const [name, router] of Object.entries(override.routers ?? {})) {
    if (typeof router !== "object" || router === null || Array.isArray(router)) {
      continue;
    }
    const existing = mergedRouters[name];
    mergedRouters[name] = {
      random: router.random ?? existing?.random,
      models: router.models ?? existing?.models,
      max: mergeTier(existing?.max, router.max),
      xhigh: mergeTier(existing?.xhigh, router.xhigh),
      high: mergeTier(existing?.high, router.high),
      medium: mergeTier(existing?.medium, router.medium),
      low: mergeTier(existing?.low, router.low),
      minimal: mergeTier(existing?.minimal, router.minimal),
      off: mergeTier(existing?.off, router.off),
    };
  }

  return {
    debug: override.debug ?? base.debug,
    routers: mergedRouters,
  };
};
