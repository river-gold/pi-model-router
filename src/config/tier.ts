import type { RoutedTierConfig, RouterTier } from "../types";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../constants";
import { ROUTER_TIERS } from "./constants";
import { isObjectRecord } from "./guards";
import { parseCanonicalModelRef } from "./modelRef";

const NEARBY_TIER_ORDER: RouterTier[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * 선호 tier부터 가까운 순서(선호 → 위쪽 → 아래쪽) 목록.
 * resolveAvailableTier와 ref 실시간 추적(src/config/ref.ts)이 공유하는 단일 순서 규칙임.
 */
export const nearbyTierOrder = (preferred: RouterTier): RouterTier[] => {
  const order: RouterTier[] = [preferred];
  const startIdx = NEARBY_TIER_ORDER.indexOf(preferred);
  for (let i = startIdx + 1; i < NEARBY_TIER_ORDER.length; i++) {
    order.push(NEARBY_TIER_ORDER[i] as RouterTier);
  }
  for (let i = startIdx - 1; i >= 0; i--) {
    order.push(NEARBY_TIER_ORDER[i] as RouterTier);
  }
  return order;
};

/**
 * 선호 tier가 없으면 가까운 tier로 폴백함 (위쪽 먼저, 없으면 아래쪽).
 * 라우팅(src/routing.ts)과 ref 해결(src/config/ref.ts)이 공유함.
 */
export const resolveAvailableTier = (
  profile: Partial<Record<RouterTier, unknown>>,
  preferred: RouterTier,
): RouterTier => {
  for (const tier of nearbyTierOrder(preferred)) {
    if (profile[tier]) return tier;
  }
  return preferred;
};

export const mergeTier = (
  existing?: RoutedTierConfig,
  next?: Partial<RoutedTierConfig>,
): RoutedTierConfig | undefined => {
  if (!existing && !next) return undefined;
  if (!next) return existing;
  if (!existing) return next as RoutedTierConfig;
  if (isObjectRecord(next) && typeof (next as Record<string, unknown>).ref === "string") {
    return { ...next } as RoutedTierConfig;
  }
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
  const rawRef = record.ref;
  if (typeof rawRef === "string") {
    const trimmed = rawRef.trim();
    const parts = trimmed.split("#");
    const ok =
      parts.length === 2 &&
      parts[0]!.trim().length > 0 &&
      (ROUTER_TIERS as readonly string[]).includes(parts[1]!.trim());
    if (!ok) {
      warnings.push(
        `Profile "${profileName}" ${tier} tier has invalid ref "${String(rawRef)}": expected "profile#tier". Tier disabled.`,
      );
      return undefined;
    }
    // 논리적 참조 유지: models 치환 없이 ref만 보관하고 라우팅 시점에 추적함.
    return { ref: trimmed };
  }
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
