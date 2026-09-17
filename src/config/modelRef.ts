import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterTier } from "../types";
import { ALLOWED_THINKING } from "./constants";
import { isRouterTier } from "./guards";

const isAllowedThinking = (value: string): value is ThinkingLevel =>
  (ALLOWED_THINKING as readonly string[]).includes(value);

/** tier 없는 위임(`@profile`)이 따라가는 기본 tier. */
export const DELEGATION_DEFAULT_TIER: RouterTier = "medium";

export interface ParsedDelegatedRef {
  profile: string;
  tier: RouterTier;
  effort?: ThinkingLevel;
}

/**
 * `@` 뒤의 위임 참조를 파싱함: `profile` / `profile#tier` / `profile#tier#effort`.
 * tier 생략 시 기본 티어(medium)를 따라감.
 */
export const parseDelegatedRef = (raw: string): ParsedDelegatedRef | undefined => {
  const parts = raw.split("#");
  if (parts.length > 3) return undefined;
  const profile = parts[0]!.trim();
  if (!profile) return undefined;
  if (parts.length === 1) return { profile, tier: DELEGATION_DEFAULT_TIER };
  const tier = parts[1]!.trim();
  if (!isRouterTier(tier)) return undefined;
  if (parts.length === 2) return { profile, tier };
  const effort = parts[2]!.trim();
  return isAllowedThinking(effort) ? { profile, tier, effort } : undefined;
};

export const parseCanonicalModelRef = (
  value: string,
): { provider: string; modelId: string; thinking?: ThinkingLevel } => {
  const hashIndex = value.indexOf("#");
  const rawRef = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const thinkingRaw = hashIndex === -1 ? undefined : value.slice(hashIndex + 1).trim();
  const slashIndex = rawRef.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid model reference "${value}". Expected "provider/model[#thinking]".`);
  }
  const provider = rawRef.slice(0, slashIndex).trim();
  const modelId = rawRef.slice(slashIndex + 1).trim();
  if (!provider || !modelId) {
    throw new Error(`Invalid model reference "${value}". Expected "provider/model[#thinking]".`);
  }
  if (thinkingRaw === undefined || thinkingRaw === "") {
    return { provider, modelId };
  }
  if (!isAllowedThinking(thinkingRaw)) {
    throw new Error(
      `Invalid thinking "${thinkingRaw}": expected one of ${ALLOWED_THINKING.join(", ")}.`,
    );
  }
  return { provider, modelId, thinking: thinkingRaw };
};

export const formatModelRef = (
  provider: string,
  modelId: string,
  thinking?: ThinkingLevel,
): string => (thinking ? `${provider}/${modelId}#${thinking}` : `${provider}/${modelId}`);
