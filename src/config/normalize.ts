import type { ConfigLoadResult, RouterConfig, Router } from "../types";
import { DEFAULT_HISTORY_SIZE, MAX_HISTORY_SIZE } from "./constants";
import { isObjectRecord } from "./guards";
import { normalizeClassifierModels } from "./classifier";
import { normalizeModelList, normalizeTierConfig } from "./tier";
import { normalizeTierGuides } from "./tierGuides";

export const normalizeConfig = (raw: RouterConfig): ConfigLoadResult => {
  const warnings: string[] = [];

  {
    const allowedKeys = new Set([
      "debug",
      "classifierModels",
      "typesafeConfidenceThreshold",
      "historySize",
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

    if (!max && !xhigh && !high && !medium && !low && !minimal) {
      warnings.push(`Router "${name}" has no valid tiers. Skipped.`);
      continue;
    }

    const rawClassifier = record.classifierModels;
    const classifierModels = normalizeClassifierModels(
      rawClassifier,
      warnings,
      `Router "${name}" classifierModels`,
    );

    normalizedRouters[name] = {
      ...(routerModels ? { models: routerModels } : {}),
      ...(max ? { max } : {}),
      ...(xhigh ? { xhigh } : {}),
      high,
      medium,
      low,
      ...(minimal ? { minimal } : {}),
      ...(classifierModels ? { classifierModels } : {}),
    };
  }

  const rawGlobalClassifier = raw.classifierModels;
  const classifierModels = normalizeClassifierModels(
    rawGlobalClassifier as unknown,
    warnings,
    "classifierModels",
  );

  let historySize: number | undefined = undefined;
  const rawHistorySize = raw.historySize;
  if (rawHistorySize !== undefined) {
    if (
      typeof rawHistorySize === "number" &&
      Number.isInteger(rawHistorySize) &&
      rawHistorySize >= 0 &&
      rawHistorySize <= MAX_HISTORY_SIZE
    ) {
      historySize = rawHistorySize;
    } else {
      warnings.push(
        `Invalid historySize "${JSON.stringify(rawHistorySize)}": expected integer between 0 and ${MAX_HISTORY_SIZE}. Using default ${DEFAULT_HISTORY_SIZE}.`,
      );
      historySize = DEFAULT_HISTORY_SIZE;
    }
  }

  const tierGuides = normalizeTierGuides(raw.tierGuides);

  let typesafeConfidenceThreshold: number | undefined = undefined;
  const rawTypesafeThreshold: unknown = raw.typesafeConfidenceThreshold;
  if (rawTypesafeThreshold !== undefined) {
    if (
      typeof rawTypesafeThreshold === "number" &&
      Number.isFinite(rawTypesafeThreshold) &&
      rawTypesafeThreshold >= 0 &&
      rawTypesafeThreshold <= 1
    ) {
      typesafeConfidenceThreshold = rawTypesafeThreshold;
    } else {
      warnings.push(
        `Invalid typesafeConfidenceThreshold "${JSON.stringify(rawTypesafeThreshold)}": expected number between 0 and 1. Ignored.`,
      );
    }
  }

  return {
    config: {
      debug: typeof raw.debug === "boolean" ? raw.debug : false,
      classifierModels,
      ...(typesafeConfidenceThreshold !== undefined ? { typesafeConfidenceThreshold } : {}),
      historySize: historySize ?? DEFAULT_HISTORY_SIZE,
      ...(tierGuides ? { tierGuides } : {}),
      routers: normalizedRouters,
    },
    warnings,
  };
};
