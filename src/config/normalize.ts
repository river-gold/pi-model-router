import type { ConfigLoadResult, RouterConfig, RouterProfile } from "../types";
import { DEFAULT_HISTORY_SIZE, MAX_HISTORY_SIZE } from "./constants";
import { isObjectRecord } from "./guards";
import { normalizeClassifierModels } from "./classifier";
import { normalizeTierConfig } from "./tier";

export const normalizeConfig = (raw: RouterConfig): ConfigLoadResult => {
  const warnings: string[] = [];

  {
    const allowedKeys = new Set(["debug", "classifierModels", "historySize", "profiles"]);
    for (const key of Object.keys(raw as unknown as Record<string, unknown>)) {
      if (!allowedKeys.has(key)) {
        warnings.push(`Unknown config field "${key}" ignored.`);
      }
    }
  }

  const normalizedProfiles: Record<string, RouterProfile> = {};

  for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
    if (!isObjectRecord(profile)) {
      warnings.push(`Profile "${name}" is not an object. Skipped.`);
      continue;
    }
    const record = profile as Record<string, unknown>;
    const max = normalizeTierConfig(record.max, name, "max", warnings);
    const xhigh = normalizeTierConfig(record.xhigh, name, "xhigh", warnings);
    const high = normalizeTierConfig(record.high, name, "high", warnings);
    const medium = normalizeTierConfig(record.medium, name, "medium", warnings);
    const low = normalizeTierConfig(record.low, name, "low", warnings);
    const minimal = normalizeTierConfig(record.minimal, name, "minimal", warnings);

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
      ...(max ? { max } : {}),
      ...(xhigh ? { xhigh } : {}),
      high,
      medium,
      low,
      ...(minimal ? { minimal } : {}),
      ...(classifierModels ? { classifierModels } : {}),
    };
  }

  const rawGlobalClassifier = (raw as unknown as Record<string, unknown>).classifierModels;
  const classifierModels = normalizeClassifierModels(
    rawGlobalClassifier as unknown,
    warnings,
    "classifierModels",
  );

  let historySize: number | undefined = undefined;
  const rawHistorySize = (raw as unknown as Record<string, unknown>).historySize;
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
        `Invalid historySize "${String(rawHistorySize)}": expected integer between 0 and ${MAX_HISTORY_SIZE}. Using default ${DEFAULT_HISTORY_SIZE}.`,
      );
      historySize = DEFAULT_HISTORY_SIZE;
    }
  }

  return {
    config: {
      debug: typeof raw.debug === "boolean" ? raw.debug : false,
      classifierModels,
      historySize: historySize ?? DEFAULT_HISTORY_SIZE,
      profiles: normalizedProfiles,
    },
    warnings,
  };
};
