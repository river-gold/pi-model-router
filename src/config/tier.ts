import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RoutedTierConfig, RouterTier } from "../types";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../constants";
import { ALLOWED_THINKING } from "./constants";
import { isObjectRecord } from "./guards";
import { parseCanonicalModelRef, parseDelegatedRef } from "./modelRef";

const NEARBY_TIER_ORDER: RouterTier[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  (ALLOWED_THINKING as readonly string[]).includes(value);

/** 모델 항목 검증: 일반 모델 참조 또는 `@` 위임 참조. */
const isValidModelEntry = (entry: string): boolean => {
  if (entry.startsWith("@")) return parseDelegatedRef(entry.slice(1)) !== undefined;
  try {
    parseCanonicalModelRef(entry);
    return true;
  } catch {
    return false;
  }
};

/**
 * 선호 tier부터 가까운 순서(선호 → 위쪽 → 아래쪽) 목록.
 * resolveAvailableTier와 ref 실시간 추적(src/config/ref.ts)이 공유하는 단일 순서 규칙임.
 */
export const nearbyTierOrder = (preferred: RouterTier): RouterTier[] => {
  const order: RouterTier[] = [preferred];
  const startIdx = NEARBY_TIER_ORDER.indexOf(preferred);
  for (const tier of NEARBY_TIER_ORDER.slice(startIdx + 1)) {
    order.push(tier);
  }
  for (const tier of NEARBY_TIER_ORDER.slice(0, startIdx).reverse()) {
    order.push(tier);
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
  if (typeof next === "undefined") return existing;
  if (typeof existing === "undefined") return next;
  return { ...existing, ...next };
};

export const normalizeModelList = (
  rawModels: unknown,
  profileName: string,
  label: string,
  warnings: string[],
): string[] | undefined => {
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    return undefined;
  }
  const models: string[] = [];
  for (const m of rawModels) {
    if (typeof m !== "string" || !m.trim()) {
      warnings.push(`Invalid model entry "${String(m)}" in profile "${profileName}" ${label}.`);
      continue;
    }
    if (m.trim().startsWith("@@")) {
      warnings.push(
        `Invalid model "${m}" in profile "${profileName}" ${label}: "@@typesafe/" entries are only supported in "classifierModels", not in tier/profile "models".`,
      );
      continue;
    }
    if (!isValidModelEntry(m.trim())) {
      warnings.push(
        `Invalid model "${m}" in profile "${profileName}" ${label}: expected "provider/model[#thinking]" or "@profile[#tier[#effort]]".`,
      );
      continue;
    }
    models.push(m.trim());
  }
  return models.length > 0 ? models : undefined;
};

export const normalizeTierConfig = (
  value: unknown,
  profileName: string,
  tier: RouterTier,
  warnings: string[],
  profileModels?: string[],
): RoutedTierConfig | undefined => {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const record = value;
  if (record.ref !== undefined) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier has removed "ref" field: use "@profile[#tier[#effort]]" entries in "models" instead. Tier disabled.`,
    );
    return undefined;
  }
  const rawModels = record.models;
  // 티어 `models`가 없으면 프로필 기본값 상속.
  let models = normalizeModelList(rawModels, profileName, `${tier} tier`, warnings);
  if (!models && profileModels?.length) {
    models = [...profileModels];
  }
  if (!models) {
    if (Array.isArray(rawModels) && rawModels.length > 0) {
      warnings.push(`Profile "${profileName}" ${tier} tier has no valid models. Tier disabled.`);
    } else {
      warnings.push(
        `Profile "${profileName}" ${tier} tier is missing "models" array. Tier disabled.`,
      );
    }
    return undefined;
  }

  const invalidTierDefault = (key: string, raw: unknown): undefined => {
    warnings.push(
      `Profile "${profileName}" ${tier} tier has invalid ${key} ${JSON.stringify(raw)}: expected one of ${(ALLOWED_THINKING as readonly string[]).join(", ")}. Ignored.`,
    );
    return undefined;
  };

  const parseTierDefault = (raw: unknown, key: string): ThinkingLevel | undefined => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !raw.trim()) {
      return invalidTierDefault(key, raw);
    }
    const v = raw.trim();
    if (!isThinkingLevel(v)) {
      return invalidTierDefault(key, raw);
    }
    return v;
  };
  const tierThinking = parseTierDefault(record.thinking, "thinking");
  const tierEffort = parseTierDefault(record.effort, "effort");
  if (tierThinking !== undefined && tierEffort !== undefined && tierThinking !== tierEffort) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier has both "thinking" and "effort": using "thinking" ("${tierThinking}").`,
    );
  }
  // 티어 강제 effort. 모델별 `#`와 위임 결과보다 우선함 (라우팅/확장에서 강제 적용).
  const thinking = tierThinking ?? tierEffort;

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
