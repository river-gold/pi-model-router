import type {
  ClassifierConfig,
  ClassifierModelsSetting,
  ClassifierRefConfig,
  ClassifierSettingEntry,
  RouterProfile,
  RouterTier,
  TypesafeClassifierConfig,
} from "../types";
import { CLASSIFIER_REF_PREFIX, TYPESAFE_ENTRY_PREFIX } from "./constants";
import { formatModelRef, parseCanonicalModelRef } from "./modelRef";
import { dereferenceTier, parseTierRef, applyEffortOverride } from "./ref";
import { isTypesafeClassifierConfig } from "./guards";

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

const ENTRY_HINT = `expected "provider/model#thinking", "@profile#tier", or "@@typesafe/<model>"`;

const normalizeClassifierRef = (
  raw: string,
  warnings: string[],
  contextLabel: string,
): ClassifierRefConfig | undefined => {
  const ref = raw.slice(CLASSIFIER_REF_PREFIX.length).trim();
  if (!parseTierRef(ref)) {
    warnings.push(
      `Invalid ${contextLabel} "${raw}": expected "@profile#tier", "@profile##effort", or "@profile#tier##effort".`,
    );
    return undefined;
  }
  return { ref };
};

/** `@@typesafe/<model>` — model은 API에 그대로 전달됨. */
const normalizeTypesafeEntry = (
  raw: string,
  warnings: string[],
  contextLabel: string,
): TypesafeClassifierConfig | undefined => {
  const model = raw.slice(TYPESAFE_ENTRY_PREFIX.length).trim();
  if (model === "") {
    warnings.push(`Invalid ${contextLabel} "${raw}": expected "@@typesafe/<model>".`);
    return undefined;
  }
  return { typesafe: true, model };
};

const normalizeClassifierEntry = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierSettingEntry | undefined => {
  if (typeof raw !== "string") {
    warnings.push(`Invalid ${contextLabel}: ${ENTRY_HINT}.`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith(TYPESAFE_ENTRY_PREFIX)) {
    return normalizeTypesafeEntry(trimmed, warnings, contextLabel);
  }
  if (trimmed.startsWith(CLASSIFIER_REF_PREFIX)) {
    return normalizeClassifierRef(trimmed, warnings, contextLabel);
  }
  return normalizeClassifierConfig(trimmed, warnings, contextLabel);
};

/**
 * classifierModels는 항상 배열이어야 함 (단일 문자열 형식은 지원하지 않음).
 * 항목 순서가 곧 분류기 폴백 순서임.
 */
export const normalizeClassifierModels = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierModelsSetting | undefined => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    warnings.push(`Invalid ${contextLabel}: ${ENTRY_HINT}. Expected an array.`);
    return undefined;
  }
  const out: ClassifierSettingEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = normalizeClassifierEntry(raw[i], warnings, `${contextLabel}[${i}]`);
    if (entry) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
};

export type ClassifierSource = "profile" | "global" | "low tier";

export type ClassifierEntry =
  | (ClassifierConfig & { source: ClassifierSource })
  | (TypesafeClassifierConfig & { source: ClassifierSource });

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

/** ref가 모두 펼쳐진 뒤 체인에 들어가는 항목. */
type ExpandedClassifierEntry = ClassifierConfig | TypesafeClassifierConfig;

/** ref 항목을 실시간 추적해서 순서를 유지한 채 실제 후보로 펼침. */
const expandClassifierModels = (
  value: ClassifierModelsSetting | undefined,
  profiles: Record<string, RouterProfile> | undefined,
): ExpandedClassifierEntry[] => {
  if (!value) return [];
  const out: ExpandedClassifierEntry[] = [];
  for (const entry of value) {
    if (isTypesafeClassifierConfig(entry)) {
      out.push(entry);
      continue;
    }
    if ("ref" in entry) {
      if (profiles) out.push(...(resolveClassifierRefModels(entry.ref, profiles) ?? []));
      continue;
    }
    out.push(entry);
  }
  return out;
};

/**
 * profile → global → low tier 순서로 분류기 체인을 만듦.
 * 항목 순서가 그대로 시도 순서가 되고, 실패하면 다음 항목으로 폴백함.
 */
export const resolveEffectiveClassifier = (
  profile: RouterProfile,
  globalClassifiers: ClassifierModelsSetting | undefined,
  profiles?: Record<string, RouterProfile>,
): { classifiers: ClassifierEntry[] | undefined; source: string } => {
  const chain: ClassifierEntry[] = [];
  const sources: string[] = [];

  const profileEntries = expandClassifierModels(profile.classifierModels, profiles);
  if (profileEntries.length > 0) {
    chain.push(...profileEntries.map((c) => ({ ...c, source: "profile" as const })));
    sources.push("profile");
  }
  const globalEntries = expandClassifierModels(globalClassifiers, profiles);
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
