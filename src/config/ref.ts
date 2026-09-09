import type { RouterTier } from "../types";
import { ROUTER_TIERS } from "./constants";
import { isObjectRecord, isRouterTier } from "./guards";
import { resolveAvailableTier } from "./tier";

const deepCopyTier = (value: Record<string, unknown>): Record<string, unknown> => {
  if (typeof structuredClone === "function") {
    return structuredClone(value) as Record<string, unknown>;
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
};

const parseTierRef = (raw: string): { profile: string; tier: RouterTier } | undefined => {
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

/**
 * profiles 원본 JSON에서 `{ ref: "profile#tier" }` tier를 참조 대상 tier 객체의
 * deep copy로 통째로 치환함. 1단계만 해결하며 전달된 객체를 직접 바꿈.
 * 대상 tier가 없으면 라우팅과 같은 규칙(resolveAvailableTier)으로 가까운 tier를 찾음.
 */
export const resolveProfileTierRefs = (
  profiles: Record<string, Record<string, unknown>>,
  warnings: string[],
): void => {
  const coords: Array<{
    profileName: string;
    tier: string;
    rawRef: string;
    refProfile: string;
    refTier: RouterTier;
  }> = [];

  for (const [profileName, profile] of Object.entries(profiles)) {
    if (!isObjectRecord(profile)) {
      continue;
    }
    for (const tier of ROUTER_TIERS) {
      const tierValue = (profile as Record<string, unknown>)[tier];
      if (!isObjectRecord(tierValue)) {
        continue;
      }
      const ref = (tierValue as Record<string, unknown>).ref;
      if (typeof ref !== "string") {
        continue;
      }
      const rawRef = ref.trim();
      const parsed = parseTierRef(rawRef);
      if (!parsed) {
        warnings.push(
          `Profile "${profileName}" ${tier} tier has invalid ref "${ref}": expected "profile#tier". Tier disabled.`,
        );
        delete (profile as Record<string, unknown>)[tier];
        continue;
      }
      if (parsed.profile === profileName && parsed.tier === tier) {
        warnings.push(
          `Profile "${profileName}" ${tier} tier references itself ("${rawRef}"). Tier disabled.`,
        );
        delete (profile as Record<string, unknown>)[tier];
        continue;
      }
      coords.push({
        profileName,
        tier,
        rawRef,
        refProfile: parsed.profile,
        refTier: parsed.tier,
      });
    }
  }

  for (const { profileName, tier, rawRef, refProfile, refTier } of coords) {
    const targetProfile = profiles[refProfile];
    if (!isObjectRecord(targetProfile)) {
      warnings.push(
        `Profile "${profileName}" ${tier} tier ref target "${rawRef}" not found. Tier disabled.`,
      );
      delete profiles[profileName]![tier];
      continue;
    }
    const target = (targetProfile as Record<string, unknown>)[refTier];
    if (!isObjectRecord(target)) {
      const nearby = resolveNearbyConcreteTier(targetProfile as Record<string, unknown>, refTier);
      if (nearby) {
        warnings.push(
          `Profile "${profileName}" ${tier} tier ref target "${rawRef}" not found. Resolved to nearby "${refProfile}#${nearby}".`,
        );
        profiles[profileName]![tier] = deepCopyTier(
          (targetProfile as Record<string, unknown>)[nearby] as Record<string, unknown>,
        );
        continue;
      }
      warnings.push(
        `Profile "${profileName}" ${tier} tier ref target "${rawRef}" not found. Tier disabled.`,
      );
      delete profiles[profileName]![tier];
      continue;
    }
    if ("ref" in (target as Record<string, unknown>)) {
      warnings.push(
        `Profile "${profileName}" ${tier} tier ref target "${rawRef}" is itself a ref. Chained refs are not resolved. Tier disabled.`,
      );
      delete profiles[profileName]![tier];
      continue;
    }
    profiles[profileName]![tier] = deepCopyTier(target as Record<string, unknown>);
  }
};

/** 대상 profile에서 ref가 아닌 tier만 보고 가까운 tier를 찾음. 없으면 undefined. */
const resolveNearbyConcreteTier = (
  targetProfile: Record<string, unknown>,
  refTier: RouterTier,
): RouterTier | undefined => {
  const concrete: Partial<Record<RouterTier, unknown>> = {};
  for (const t of ROUTER_TIERS) {
    const value = targetProfile[t];
    if (isObjectRecord(value) && !("ref" in value)) {
      concrete[t] = value;
    }
  }
  const nearby = resolveAvailableTier(concrete, refTier);
  if (nearby === refTier) {
    return undefined;
  }
  return nearby;
};
