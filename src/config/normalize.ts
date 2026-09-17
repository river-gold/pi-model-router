import type { ConfigLoadResult, RouterConfig, RouterProfile } from "../types";
import { DEFAULT_HISTORY_SIZE, MAX_HISTORY_SIZE } from "./constants";
import { isObjectRecord } from "./guards";
import { normalizeClassifierModels } from "./classifier";
import { normalizeModelList, normalizeTierConfig } from "./tier";
import { resolveProfileTierRefs } from "./ref";
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
      "profiles",
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowedKeys.has(key)) {
        warnings.push(`Unknown config field "${key}" ignored.`);
      }
    }
  }

  const normalizedProfiles: Record<string, RouterProfile> = {};

  const rawProfiles: Record<string, Record<string, unknown>> = {};
  for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
    if (!isObjectRecord(profile)) {
      warnings.push(`Profile "${name}" is not an object. Skipped.`);
      continue;
    }
    rawProfiles[name] = { ...profile };
  }
  resolveProfileTierRefs(rawProfiles, warnings);

  for (const [name, record] of Object.entries(rawProfiles)) {
    // 프로필 기본 모델: 티어 `models`가 없을 때 상속됨.
    let profileModels: string[] | undefined;
    if (record.models !== undefined) {
      const parsed = normalizeModelList(record.models, name, "profile models", warnings);
      if (!parsed) {
        warnings.push(`Profile "${name}" has no valid profile-level "models". Ignored.`);
      } else {
        profileModels = parsed;
      }
    }
    const max = normalizeTierConfig(record.max, name, "max", warnings, profileModels);
    const xhigh = normalizeTierConfig(record.xhigh, name, "xhigh", warnings, profileModels);
    const high = normalizeTierConfig(record.high, name, "high", warnings, profileModels);
    const medium = normalizeTierConfig(record.medium, name, "medium", warnings, profileModels);
    const low = normalizeTierConfig(record.low, name, "low", warnings, profileModels);
    const minimal = normalizeTierConfig(record.minimal, name, "minimal", warnings, profileModels);

    if (!max && !xhigh && !high && !medium && !low && !minimal) {
      warnings.push(`Profile "${name}" has no valid tiers. Skipped.`);
      continue;
    }

    const rawClassifier = record.classifierModels;
    const classifierModels = normalizeClassifierModels(
      rawClassifier,
      warnings,
      `Profile "${name}" classifierModels`,
    );

    normalizedProfiles[name] = {
      ...(profileModels ? { models: profileModels } : {}),
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
      profiles: normalizedProfiles,
    },
    warnings,
  };
};
