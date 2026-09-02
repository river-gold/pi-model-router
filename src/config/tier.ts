import type { RoutedTierConfig, RouterTier } from "../types";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../constants";
import { isObjectRecord } from "./guards";
import { parseCanonicalModelRef } from "./modelRef";

export const mergeTier = (
  existing?: RoutedTierConfig,
  next?: Partial<RoutedTierConfig>,
): RoutedTierConfig | undefined => {
  if (!existing && !next) return undefined;
  if (!next) return existing;
  if (!existing) return next as RoutedTierConfig;
  return { ...existing, ...next };
};

export const normalizeTierConfig = (
  value: unknown,
  profileName: string,
  tier: RouterTier,
  warnings: string[],
): RoutedTierConfig | undefined => {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const rawModels = record.models;
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier is missing "models" array. Tier disabled.`,
    );
    return undefined;
  }

  const models: string[] = [];
  for (const m of rawModels) {
    if (typeof m !== "string" || !m.trim()) {
      warnings.push(`Invalid model entry "${String(m)}" in profile "${profileName}" ${tier} tier.`);
      continue;
    }
    try {
      parseCanonicalModelRef(m.trim());
      models.push(m.trim());
    } catch (error) {
      warnings.push(
        `Invalid model "${m}" in profile "${profileName}" ${tier} tier: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (models.length === 0) {
    warnings.push(`Profile "${profileName}" ${tier} tier has no valid models. Tier disabled.`);
    return undefined;
  }

  const primaryParsed = parseCanonicalModelRef(models[0]!);
  const thinking = primaryParsed.thinking;

  let tierContextWindow: number | undefined;
  if (typeof record.contextWindow === "number") {
    if (record.contextWindow > 0) {
      tierContextWindow = record.contextWindow;
    }
  }
  const resolvedContextWindow = tierContextWindow ?? DEFAULT_CONTEXT_WINDOW;

  let tierMaxTokens: number | undefined;
  if (typeof record.maxTokens === "number") {
    if (record.maxTokens > 0) {
      tierMaxTokens = record.maxTokens;
    }
  }
  const resolvedMaxTokens = tierMaxTokens ?? DEFAULT_MAX_TOKENS;

  const tierReasoning = typeof record.reasoning === "boolean" ? record.reasoning : undefined;

  return {
    models,
    thinking,
    contextWindow: tierContextWindow,
    maxTokens: tierMaxTokens,
    reasoning: tierReasoning,
    resolvedContextWindow,
    resolvedMaxTokens,
  };
};
