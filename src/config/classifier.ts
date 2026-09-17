import type {
  ClassifierConfig,
  ClassifierModelsSetting,
  RouterProfile,
  RouterTier,
} from "../types";
import { TYPESAFE_CLASSIFIER_REF } from "./constants";
import { formatModelRef, parseCanonicalModelRef } from "./modelRef";
import { dereferenceTier, isTierRef, parseTierRef, applyEffortOverride } from "./ref";
import { isTypesafeClassifierRef } from "./guards";

export const normalizeClassifierConfig = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierConfig | undefined => {
  if (typeof raw !== "string") return undefined;
  if (raw.trim() === "") return undefined;
  try {
    const { provider, modelId, thinking } = parseCanonicalModelRef(raw.trim());
    return { model: formatModelRef(provider, modelId), thinking };
  } catch (error) {
    warnings.push(
      `Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
};

export const normalizeClassifierModels = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierModelsSetting | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw === "string" && raw.trim() === TYPESAFE_CLASSIFIER_REF) {
    return { typesafe: true };
  }
  if (isTierRef(raw)) {
    const trimmed = raw.ref.trim();
    if (!parseTierRef(trimmed)) {
      warnings.push(
        `Invalid ${contextLabel} ref "${raw.ref}": expected "profile#tier", "profile##effort", or "profile#tier##effort".`,
      );
      return undefined;
    }
    // 논리적 참조 유지: 분류기 실행 시점에 실시간 추적함.
    return { ref: trimmed };
  }
  if (typeof raw === "string") {
    const single = normalizeClassifierConfig(raw, warnings, contextLabel);
    return single ? [single] : undefined;
  }
  if (Array.isArray(raw)) {
    const out: ClassifierConfig[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = normalizeClassifierConfig(raw[i], warnings, `${contextLabel}[${i}]`);
      if (c) out.push(c);
    }
    return out.length > 0 ? out : undefined;
  }
  warnings.push(`Invalid ${contextLabel}: expected string, array of strings, or { ref }.`);
  return undefined;
};

export type ClassifierSource = "profile" | "global" | "low tier";

export type ClassifierEntry = ClassifierConfig & { source: ClassifierSource };

/** `##effort`만 있을 때 따라갈 기본 tier. 분류기는 저비용 모델이 어울리고 기존 폴백도 low tier를 씀. */
const CLASSIFIER_DEFAULT_TIER: RouterTier = "low";

/**
 * classifierModels ref를 실시간 추적해서 분류기 후보 목록으로 펼침.
 * `##effort` 지정은 최종 모델에 그대로 반영됨 (dereferenceTier가 `#effort`로 다시 씀).
 */
export const resolveClassifierRefModels = (
  ref: string,
  profiles: Record<string, RouterProfile>,
): ClassifierConfig[] | undefined => {
  const parsed = parseTierRef(ref.trim());
  if (!parsed) return undefined;
  const resolved = dereferenceTier(
    profiles,
    parsed.profile,
    parsed.tier ?? CLASSIFIER_DEFAULT_TIER,
  );
  if (!resolved) return undefined;
  // ref 자리에 직접 적힌 ##가 체인 안쪽 ##보다 우선함 (first-wins).
  const config = parsed.effort
    ? applyEffortOverride(resolved.config, parsed.effort)
    : resolved.config;
  const fallbackThinking = config.thinking;
  return config.models!.map((m) => {
    const { provider, modelId, thinking } = parseCanonicalModelRef(m);
    return { model: formatModelRef(provider, modelId), thinking: thinking ?? fallbackThinking };
  });
};

const expandClassifierModels = (
  value: ClassifierModelsSetting | undefined,
  profiles: Record<string, RouterProfile> | undefined,
  profileName: string | undefined,
): ClassifierConfig[] => {
  if (Array.isArray(value)) return value;
  if (isTypesafeClassifierRef(value)) return [];
  if (value && profiles && profileName) {
    return resolveClassifierRefModels(value.ref, profiles) ?? [];
  }
  return [];
};

/**
 * TypeSafe System One 분류기를 쓸지 결정함.
 * 프로필 설정이 전역 설정보다 우선함 (기존 classifierModels 우선순위와 동일).
 */
export const resolveTypesafeClassifier = (
  profile: RouterProfile,
  globalClassifiers: ClassifierModelsSetting | undefined,
): boolean =>
  isTypesafeClassifierRef(profile.classifierModels) ||
  (profile.classifierModels === undefined && isTypesafeClassifierRef(globalClassifiers));

export const resolveEffectiveClassifier = (
  profile: RouterProfile,
  globalClassifiers: ClassifierModelsSetting | undefined,
  profiles?: Record<string, RouterProfile>,
  profileName?: string,
): { classifiers: ClassifierEntry[] | undefined; source: string } => {
  const chain: ClassifierEntry[] = [];
  const sources: string[] = [];

  const profileEntries = expandClassifierModels(profile.classifierModels, profiles, profileName);
  if (profileEntries.length > 0) {
    chain.push(...profileEntries.map((c) => ({ ...c, source: "profile" as const })));
    sources.push("profile");
  }
  const globalEntries = expandClassifierModels(globalClassifiers, profiles, profileName);
  if (globalEntries.length > 0) {
    chain.push(...globalEntries.map((c) => ({ ...c, source: "global" as const })));
    sources.push("global");
  }
  const lowModels = profile.low?.models;
  if (lowModels && lowModels.length > 0) {
    chain.push(
      ...lowModels.map((m) => {
        const { provider, modelId, thinking } = parseCanonicalModelRef(m);
        return {
          model: formatModelRef(provider, modelId),
          thinking,
          source: "low tier" as const,
        };
      }),
    );
    sources.push("low tier");
  }

  return {
    classifiers: chain.length > 0 ? chain : undefined,
    source: sources.length > 0 ? sources.join(" → ") : "none",
  };
};
