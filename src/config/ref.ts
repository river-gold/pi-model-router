import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RoutedTierConfig, RouterProfile, RouterTier } from "../types";
import { ROUTER_TIERS } from "./constants";
import { isObjectRecord } from "./guards";
import { formatModelRef, parseCanonicalModelRef, parseDelegatedRef } from "./modelRef";
import { nearbyTierOrder, resolveAvailableTier } from "./tier";

/** tier의 강제 effort. 로드 시점에 thinking/effort가 통합되어 thinking에 저장됨. */
export const tierForcing = (config: RoutedTierConfig): ThinkingLevel | undefined =>
  config.thinking ?? config.effort;

/**
 * 강제 effort를 최종 모델 목록에 적용함.
 * 모델별 `#`와 위임 대상 tier의 강제값보다 우선해서 `provider/model#effort`로 다시 씀.
 */
export const applyEffortOverride = (
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

export interface ResolvedTier {
  /** 요청한 원본 profile */
  profileName: string;
  /** 요청한 원본 tier (가까운 tier로 폴백되면 폴백된 tier) */
  tier: RouterTier;
  /** models는 위임을 실시간으로 펼친 최종 모델 목록 */
  config: RoutedTierConfig;
  /** 거친 위임 경로 ("cheap#low -> glm-flash#medium") */
  chain: string[];
}

const isConcreteTier = (value: unknown): value is RoutedTierConfig =>
  isObjectRecord(value) && Array.isArray(value.models) && value.models.length > 0;

/**
 * profile의 tier 원본 설정을 찾음. 해당 tier가 없으면
 * 같은 profile 안의 가까운 tier(resolveAvailableTier 순서)로 폴백함.
 */
const tierEntryOf = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
): { entry: RoutedTierConfig; tier: RouterTier } | undefined => {
  const profile = profiles[profileName];
  if (!isObjectRecord(profile)) return undefined;
  const entry = profile[tier];
  if (isConcreteTier(entry)) return { entry, tier };
  const concrete: Partial<Record<RouterTier, RoutedTierConfig>> = {};
  for (const t of ROUTER_TIERS) {
    const value = profile[t];
    if (isConcreteTier(value)) concrete[t] = value;
  }
  const picked = resolveAvailableTier(concrete, tier);
  const pickedEntry = concrete[picked];
  return pickedEntry ? { entry: pickedEntry, tier: picked } : undefined;
};

/** 펼침 대기 중인 모델 항목. override는 바깥에서 누적된 강제 effort (first-wins). */
interface ModelNode {
  raw: string;
  override: ThinkingLevel | undefined;
  visited: ReadonlySet<string>;
}

interface ExpansionContext {
  profiles: Record<string, RouterProfile>;
  hopsLeft: number;
  chain: string[];
  out: string[];
}

/** 위임 경로 기록. 연속 중복은 합침. */
const pushChain = (ctx: ExpansionContext, key: string): void => {
  if (ctx.chain[ctx.chain.length - 1] !== key) ctx.chain.push(key);
};

/**
 * 큐의 맨 앞 모델을 처리하고 나머지로 꼬리 재귀함.
 * - 일반 모델: 강제 effort가 있으면 덮어써서 출력함.
 * - `@` 위임: 대상 tier 설정을 찾아(없으면 가까운 tier) 자식 모델 노드를 큐 맨 앞에 넣어 확장함.
 *   순환하거나 해석 불가인 위임 항목은 건너뜀.
 */
const expandQueue = (ctx: ExpansionContext, queue: ModelNode[]): void => {
  const head = queue[0];
  if (head === undefined || ctx.hopsLeft <= 0) return;
  ctx.hopsLeft -= 1;
  const rest = queue.slice(1);
  const trimmed = head.raw.trim();
  if (trimmed.startsWith("@")) {
    const parsed = parseDelegatedRef(trimmed.slice(1).trim());
    const found = parsed ? tierEntryOf(ctx.profiles, parsed.profile, parsed.tier) : undefined;
    if (!parsed || !found || head.visited.has(`${parsed.profile}#${found.tier}`)) {
      expandQueue(ctx, rest);
      return;
    }
    pushChain(ctx, `${parsed.profile}#${found.tier}`);
    const override = head.override ?? parsed.effort ?? tierForcing(found.entry);
    const nextVisited = new Set(head.visited);
    nextVisited.add(`${parsed.profile}#${found.tier}`);
    expandQueue(ctx, [
      ...found.entry.models!.map((raw) => ({ raw, override, visited: nextVisited })),
      ...rest,
    ]);
    return;
  }
  try {
    const { provider, modelId, thinking } = parseCanonicalModelRef(trimmed);
    ctx.out.push(formatModelRef(provider, modelId, head.override ?? thinking));
  } catch {
    // 정규화에서 걸러지므로 발생하지 않음. 방어적으로 건너뜀.
  }
  expandQueue(ctx, rest);
};

/** 펼침 예산. 위임이 깊어져도 종료되도록 함. */
const MAX_EXPANSION_HOPS = 256;

/**
 * `profiles[profileName][tier]`의 models를 실시간으로 펼침.
 * models의 `@profile` / `@profile#tier` / `#profile#tier#effort` 항목을
 * 대상 profile/tier의 모델로 확장하고, tier의 강제 effort(thinking/effort)를
 * 모델별 `#`와 위임 결과보다 우선 적용함. 대상 tier가 없으면 가까운 tier로 폴백함.
 * 펼친 모델이 하나도 없으면 undefined.
 */
export const dereferenceTier = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
): ResolvedTier | undefined => {
  const located = tierEntryOf(profiles, profileName, tier);
  if (!located) return undefined;
  const topKey = `${profileName}#${located.tier}`;
  const ctx: ExpansionContext = { profiles, hopsLeft: MAX_EXPANSION_HOPS, chain: [], out: [] };
  pushChain(ctx, topKey);
  const topVisited: ReadonlySet<string> = new Set([topKey]);
  const topOverride = tierForcing(located.entry);
  expandQueue(
    ctx,
    located.entry.models!.map((raw) => ({ raw, override: topOverride, visited: topVisited })),
  );
  if (ctx.out.length === 0) return undefined;
  return {
    profileName,
    tier: located.tier,
    config: { ...located.entry, models: ctx.out, thinking: tierForcing(located.entry) },
    chain: [...ctx.chain],
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
