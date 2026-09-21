import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgyClassifierConfig,
  ClassifierConfig,
  ClassifierModelsSetting,
  ClassifierRefConfig,
  ClassifierSettingEntry,
  Router,
  TypesafeClassifierConfig,
} from "../types";
import {
  AGY_EFFORT_SEPARATOR,
  AGY_ENTRY_PREFIX,
  ALLOWED_THINKING,
  CLASSIFIER_REF_PREFIX,
  TYPESAFE_ENTRY_PREFIX,
} from "./constants";
import { formatModelRef, parseCanonicalModelRef, parseDelegatedRef } from "./modelRef";
import { dereferenceTier, applyEffortOverride } from "./ref";
import { isAgyClassifierConfig, isTypesafeClassifierConfig } from "./guards";

export const normalizeClassifierConfig = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierConfig | undefined => {
  if (typeof raw !== "string") return undefined;
  if (raw.trim() === "") return undefined;
  try {
    const { provider, modelId, effort } = parseCanonicalModelRef(raw.trim());
    return { model: formatModelRef(provider, modelId), effort };
  } catch (error) {
    warnings.push(
      `Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
};

const ENTRY_HINT = `expected "provider/model#effort", "@router", "@router#tier", "@router#tier#effort", "@@typesafe/<model>", or "@@agy/<model>[:<effort>]"`;

const normalizeClassifierRef = (
  raw: string,
  warnings: string[],
  contextLabel: string,
): ClassifierRefConfig | undefined => {
  const ref = raw.slice(CLASSIFIER_REF_PREFIX.length).trim();
  if (!parseDelegatedRef(ref)) {
    warnings.push(
      `Invalid ${contextLabel} "${raw}": expected "@router", "@router#tier", or "@router#tier#effort".`,
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

/** `@@agy/<model>[:<effort>]` — effort는 agy 모델 variant(high/medium/low)로 매핑됨. */
const normalizeAgyEntry = (
  raw: string,
  warnings: string[],
  contextLabel: string,
): AgyClassifierConfig | undefined => {
  const rest = raw.slice(AGY_ENTRY_PREFIX.length).trim();
  const sepIndex = rest.indexOf(AGY_EFFORT_SEPARATOR);
  const model = (sepIndex === -1 ? rest : rest.slice(0, sepIndex)).trim();
  const effortRaw = sepIndex === -1 ? undefined : rest.slice(sepIndex + 1).trim();
  if (!model) {
    warnings.push(`Invalid ${contextLabel} "${raw}": expected "@@agy/<model>[:<effort>]".`);
    return undefined;
  }
  if (
    effortRaw !== undefined &&
    !((ALLOWED_THINKING as readonly string[]).includes(effortRaw) && effortRaw !== "off")
  ) {
    warnings.push(
      `Invalid ${contextLabel} "${raw}": effort must be one of low, medium, high (got "${effortRaw}").`,
    );
    return undefined;
  }
  return { agy: true, model, ...(effortRaw ? { effort: effortRaw as ThinkingLevel } : {}) };
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
  if (trimmed.startsWith(AGY_ENTRY_PREFIX)) {
    return normalizeAgyEntry(trimmed, warnings, contextLabel);
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

export type ClassifierSource = "router" | "global" | "low tier";

export type ClassifierEntry =
  | (ClassifierConfig & { source: ClassifierSource })
  | (TypesafeClassifierConfig & { source: ClassifierSource })
  | (AgyClassifierConfig & { source: ClassifierSource });

/**
 * classifierModels ref를 실시간 추적해서 분류기 후보 목록으로 펼침.
 * tier 생략 시 대상 router의 기본 티어(medium)를 따라감.
 * `#effort` 직접 지정은 최종 모델에 그대로 반영됨 (dereferenceTier가 강제 effort를 적용함).
 */
export const resolveClassifierRefModels = (
  ref: string,
  routers: Record<string, Router>,
): ClassifierConfig[] | undefined => {
  const parsed = parseDelegatedRef(ref.trim());
  if (!parsed) return undefined;
  const resolved = dereferenceTier(routers, parsed.router, parsed.tier);
  if (!resolved) return undefined;
  // ref 자리에 직접 적힌 #effort가 위임 경로의 강제값보다 우선함 (first-wins).
  const config = parsed.effort
    ? applyEffortOverride(resolved.config, parsed.effort)
    : resolved.config;
  const fallbackEffort = config.effort;
  return config.models!.map((m) => {
    const { provider, modelId, effort } = parseCanonicalModelRef(m);
    return { model: formatModelRef(provider, modelId), effort: effort ?? fallbackEffort };
  });
};

/** ref가 모두 펼쳐진 뒤 체인에 들어가는 항목. */
type ExpandedClassifierEntry = ClassifierConfig | TypesafeClassifierConfig | AgyClassifierConfig;

/** ref 항목을 실시간 추적해서 순서를 유지한 채 실제 후보로 펼침. */
const expandClassifierModels = (
  value: ClassifierModelsSetting | undefined,
  routers: Record<string, Router> | undefined,
): ExpandedClassifierEntry[] => {
  if (!value) return [];
  const out: ExpandedClassifierEntry[] = [];
  for (const entry of value) {
    if (isTypesafeClassifierConfig(entry) || isAgyClassifierConfig(entry)) {
      out.push(entry);
      continue;
    }
    if ("ref" in entry) {
      if (routers) out.push(...(resolveClassifierRefModels(entry.ref, routers) ?? []));
      continue;
    }
    out.push(entry);
  }
  return out;
};

/**
 * router → global → low tier 순서로 분류기 체인을 만듦.
 * 항목 순서가 그대로 시도 순서가 되고, 실패하면 다음 항목으로 폴백함.
 */
export const resolveEffectiveClassifier = (
  router: Router,
  globalClassifiers: ClassifierModelsSetting | undefined,
  routers?: Record<string, Router>,
): { classifiers: ClassifierEntry[] | undefined; source: string } => {
  const chain: ClassifierEntry[] = [];
  const sources: string[] = [];

  const routerEntries = expandClassifierModels(router.classifierModels, routers);
  if (routerEntries.length > 0) {
    chain.push(...routerEntries.map((c) => ({ ...c, source: "router" as const })));
    sources.push("router");
  }
  const globalEntries = expandClassifierModels(globalClassifiers, routers);
  if (globalEntries.length > 0) {
    chain.push(...globalEntries.map((c) => ({ ...c, source: "global" as const })));
    sources.push("global");
  }
  const lowTier = router.low;
  if (lowTier?.models && lowTier.models.length > 0) {
    const lowEntries: ClassifierConfig[] = [];
    for (const m of lowTier.models) {
      const trimmed = m.trim();
      // low tier의 `@` 위임 항목은 라우팅 시점에 실시간으로 펼침.
      if (trimmed.startsWith("@")) {
        if (routers)
          lowEntries.push(...(resolveClassifierRefModels(trimmed.slice(1), routers) ?? []));
        continue;
      }
      const { provider, modelId, effort } = parseCanonicalModelRef(trimmed);
      lowEntries.push({ model: formatModelRef(provider, modelId), effort });
    }
    // low tier의 강제 effort가 펼쳐진 후보 전체에 우선함.
    chain.push(
      ...lowEntries.map((c) => ({
        model: c.model,
        effort: lowTier.effort ?? c.effort,
        source: "low tier" as const,
      })),
    );
    sources.push("low tier");
  }

  return {
    classifiers: chain.length > 0 ? chain : undefined,
    source: sources.length > 0 ? sources.join(" → ") : "none",
  };
};
