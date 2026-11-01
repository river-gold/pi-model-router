import type { ConfigLoadResult, RouterConfig, Router } from "../types";
import { isObjectRecord } from "./guards";
import { normalizeModelList, normalizeTierConfig } from "./tier";

export const normalizeConfig = (raw: RouterConfig): ConfigLoadResult => {
  const warnings: string[] = [];

  {
    const allowedKeys = new Set([
      "debug",
      "classifierModels",
      "typesafeConfidenceThreshold",
      "historySize",
      "routeEveryTurn",
      "tierGuides",
      "routers",
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowedKeys.has(key)) {
        warnings.push(`Unknown config field "${key}" ignored.`);
      }
    }
  }

  const normalizedRouters: Record<string, Router> = {};

  const rawRouters: Record<string, Record<string, unknown>> = {};
  for (const [name, router] of Object.entries(raw.routers ?? {})) {
    if (!isObjectRecord(router)) {
      warnings.push(`Router "${name}" is not an object. Skipped.`);
      continue;
    }
    rawRouters[name] = { ...router };
  }

  for (const [name, record] of Object.entries(rawRouters)) {
    // 라우터 기본 모델: 티어 `models`가 없을 때 상속됨.
    let routerModels: string[] | undefined;
    if (record.models !== undefined) {
      const parsed = normalizeModelList(record.models, name, "router models", warnings);
      if (!parsed) {
        warnings.push(`Router "${name}" has no valid router-level "models". Ignored.`);
      } else {
        routerModels = parsed;
      }
    }
    const max = normalizeTierConfig(record.max, name, "max", warnings, routerModels);
    const xhigh = normalizeTierConfig(record.xhigh, name, "xhigh", warnings, routerModels);
    const high = normalizeTierConfig(record.high, name, "high", warnings, routerModels);
    const medium = normalizeTierConfig(record.medium, name, "medium", warnings, routerModels);
    const low = normalizeTierConfig(record.low, name, "low", warnings, routerModels);
    const minimal = normalizeTierConfig(record.minimal, name, "minimal", warnings, routerModels);
    const off = normalizeTierConfig(record.off, name, "off", warnings, routerModels);

    if (!max && !xhigh && !high && !medium && !low && !minimal && !off) {
      warnings.push(`Router "${name}" has no valid tiers. Skipped.`);
      continue;
    }

    normalizedRouters[name] = {
      ...(routerModels ? { models: routerModels } : {}),
      ...(max ? { max } : {}),
      ...(xhigh ? { xhigh } : {}),
      high,
      medium,
      low,
      ...(minimal ? { minimal } : {}),
      ...(off ? { off } : {}),
    };
  }

  return {
    config: {
      debug: typeof raw.debug === "boolean" ? raw.debug : false,
      routers: normalizedRouters,
    },
    warnings,
  };
};
