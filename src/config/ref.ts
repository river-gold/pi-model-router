import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RoutedTierConfig, RouterProfile, RouterTier } from "../types";
import { ALLOWED_THINKING, ROUTER_TIERS } from "./constants";
import { isObjectRecord, isRouterTier } from "./guards";
import { formatModelRef, parseCanonicalModelRef } from "./modelRef";
import { nearbyTierOrder, resolveAvailableTier } from "./tier";

export interface ParsedTierRef {
  profile: string;
  /** 없으면 요청 tier를 따라감 (`profile##effort` 형식). */
  tier?: RouterTier;
  /** `##`로 직접 지정한 effort. tier/model의 `#`보다 우선함. */
  effort?: ThinkingLevel;
}

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  (ALLOWED_THINKING as readonly string[]).includes(value);

export const parseTierRef = (raw: string): ParsedTierRef | undefined => {
  const doubleHash = raw.indexOf("##");
  if (doubleHash !== -1) {
    const left = raw.slice(0, doubleHash).trim();
    const effortRaw = raw.slice(doubleHash + 2).trim();
    if (!left || !isThinkingLevel(effortRaw)) {
      return undefined;
    }
    const singleHash = left.indexOf("#");
    if (singleHash === -1) {
      return { profile: left, effort: effortRaw };
    }
    const profile = left.slice(0, singleHash).trim();
    const tier = left.slice(singleHash + 1).trim();
    if (!profile || !isRouterTier(tier)) {
      return undefined;
    }
    return { profile, tier, effort: effortRaw };
  }
  const parts = raw.split("#");
  if (parts.length !== 2) {
    return undefined;
  }
  const profile = parts[0]!.trim();
  const tier = parts[1]!.trim();
  if (!profile || !tier || !isRouterTier(tier)) {
    return undefined;
  }
  return { profile, tier };
};

export const isTierRef = (value: unknown): value is { ref: string } =>
  isObjectRecord(value) && typeof value.ref === "string";

/**
 * 요청 tier 자리에 적힌 ref가 `##effort` 직접 지정인지.
 * 분류기 스킵 판단용: 기본 tier가 강제 지정이면 분류기를 돌릴 의미가 없음.
 */
export const isDirectEffortRef = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
): boolean => {
  const profile = profiles[profileName];
  if (!isObjectRecord(profile)) return false;
  const entry = profile[tier];
  if (!isTierRef(entry)) return false;
  return parseTierRef(entry.ref.trim())?.effort !== undefined;
};

/**
 * 로드 시점 검증만 수행함. 치환하지 않고 `{ ref }`를 그대로 둬서
 * 라우팅 시점에 실시간으로 추적(dereferenceTier)하도록 함.
 * 형식이 깨졌거나 자기참조인 tier만 비활성화하고 삭제함.
 */
export const resolveProfileTierRefs = (
  profiles: Record<string, Record<string, unknown>>,
  warnings: string[],
): void => {
  for (const [profileName, profile] of Object.entries(profiles)) {
    if (!isObjectRecord(profile)) {
      continue;
    }
    for (const tier of ROUTER_TIERS) {
      const tierValue = profile[tier];
      if (!isObjectRecord(tierValue)) {
        continue;
      }
      const ref = tierValue.ref;
      if (typeof ref !== "string") {
        continue;
      }
      const rawRef = ref.trim();
      const parsed = parseTierRef(rawRef);
      if (!parsed) {
        warnings.push(
          `Profile "${profileName}" ${tier} tier has invalid ref "${ref}": expected "profile#tier", "profile##effort", or "profile#tier##effort". Tier disabled.`,
        );
        delete profile[tier];
        continue;
      }
      const isSelfRef =
        parsed.profile === profileName && (parsed.tier === undefined || parsed.tier === tier);
      if (isSelfRef) {
        warnings.push(
          `Profile "${profileName}" ${tier} tier references itself ("${rawRef}"). Tier disabled.`,
        );
        delete profile[tier];
      }
    }
  }
};

export interface ResolvedTier {
  /** 실제 설정이 있는 profile */
  profileName: string;
  /** 실제 설정이 있는 tier */
  tier: RouterTier;
  /** 참조 추적 후 도달한 구체 설정 */
  config: RoutedTierConfig;
  /** 거친 참조 경로 ("a#medium -> b#high") */
  chain: string[];
}

const MAX_REF_HOPS = ROUTER_TIERS.length * 6;

const isConcreteTier = (value: unknown): value is RoutedTierConfig =>
  isObjectRecord(value) &&
  typeof value.ref !== "string" &&
  Array.isArray(value.models) &&
  value.models.length > 0 &&
  value.models.every((item) => typeof item === "string");

/**
 * `##effort` 직접 지정을 최종 모델 목록에 적용함.
 * 모델별 `#`와 tier 기본값보다 우선해서 `provider/model#effort`로 다시 씀.
 */
const applyEffortOverride = (
  config: RoutedTierConfig,
  effort: ThinkingLevel | undefined,
): RoutedTierConfig => {
  if (!effort) return config;
  return {
    ...config,
    models: config.models!.map((model) => {
      const { provider, modelId } = parseCanonicalModelRef(model);
      return formatModelRef(provider, modelId, effort);
    }),
    thinking: effort,
  };
};

/**
 * `profiles[profileName][tier]`를 실시간으로 추적함.
 * ref 체인을 끝까지 따라가고(순환 방지), 대상 tier가 없으면 대상 profile 안에서
 * 가까운 tier(resolveAvailableTier 순서)로 폴백함. 모두 실패하면 undefined.
 * `##effort`가 있으면 tier 없이 요청 tier를 따라가고, 최종 모델에 effort를 직접 지정함.
 * 체인에 `##`가 여러 개면 요청 측에 가장 가까운(첫 번째) 지정을 유지함.
 */
export const dereferenceTier = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
): ResolvedTier | undefined => {
  const visited = new Set<string>();
  const chain: string[] = [];
  let currentProfile = profileName;
  let currentTier = tier;
  let effortOverride: ThinkingLevel | undefined;

  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    const key = `${currentProfile}#${currentTier}`;
    if (visited.has(key)) {
      return undefined;
    }
    visited.add(key);

    const targetProfile = profiles[currentProfile];
    if (!isObjectRecord(targetProfile)) {
      return undefined;
    }
    const entry = targetProfile[currentTier];
    if (!isObjectRecord(entry)) {
      chain.push(key);
      return nearbyDereference(profiles, currentProfile, currentTier, chain, effortOverride);
    }
    const ref = entry.ref;
    if (typeof ref === "string") {
      const parsed = parseTierRef(ref.trim());
      if (!parsed) {
        return undefined;
      }
      chain.push(parsed.effort ? `${key}##${parsed.effort}` : key);
      if (parsed.effort && effortOverride === undefined) {
        effortOverride = parsed.effort;
      }
      currentProfile = parsed.profile;
      currentTier = parsed.tier ?? currentTier;
      continue;
    }
    if (!isConcreteTier(entry)) {
      return undefined;
    }
    chain.push(key);
    return {
      profileName: currentProfile,
      tier: currentTier,
      config: applyEffortOverride(entry, effortOverride),
      chain: [...chain],
    };
  }
  return undefined;
};

/** 대상 profile 안에서 ref가 아닌 가까운 tier를 실시간 추적해서 찾음. 순서 규칙은 resolveAvailableTier와 공유함. */
const nearbyDereference = (
  profiles: Record<string, RouterProfile>,
  targetProfileName: string,
  wantedTier: RouterTier,
  chain: string[],
  effortOverride: ThinkingLevel | undefined,
): ResolvedTier | undefined => {
  // 호출 전 currentProfile이 객체임이 확인되므로 직접 인덱싱함.
  const targetProfile = profiles[targetProfileName];
  const concrete: Partial<Record<RouterTier, RoutedTierConfig>> = {};
  for (const t of ROUTER_TIERS) {
    const value = targetProfile[t];
    if (isConcreteTier(value)) {
      concrete[t] = value;
    }
  }
  const picked = resolveAvailableTier(concrete, wantedTier);
  const pickedConfig = concrete[picked];
  if (!pickedConfig) return undefined;
  const key = `${targetProfileName}#${picked}`;
  chain.push(key);
  return {
    profileName: targetProfileName,
    tier: picked,
    config: applyEffortOverride(pickedConfig, effortOverride),
    chain: [...chain],
  };
};

/**
 * 원본 profile에서 요청 tier 기준으로 실제 해석 가능한 가장 가까운 tier를 찾음.
 * 반환의 tier는 원본 profile의 tier, resolved는 추적 결과임.
 */
export const resolveAvailableTierLive = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  preferred: RouterTier,
): { tier: RouterTier; resolved: ResolvedTier } | undefined => {
  const profile = profiles[profileName];
  if (!isObjectRecord(profile)) return undefined;
  for (const t of nearbyTierOrder(preferred)) {
    if (!isObjectRecord(profile[t])) continue;
    const resolved = dereferenceTier(profiles, profileName, t);
    if (resolved) return { tier: t, resolved };
  }
  return undefined;
};

/** 해석 가능한 tier 목록 (single-tier 판정용). */
export const resolvableTiers = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
): RouterTier[] => {
  const profile = profiles[profileName];
  if (!isObjectRecord(profile)) return [];
  return ROUTER_TIERS.filter(
    (t) => isObjectRecord(profile[t]) && dereferenceTier(profiles, profileName, t) !== undefined,
  );
};
