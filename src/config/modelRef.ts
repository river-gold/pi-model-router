import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterTier } from "../types";
import { ALLOWED_THINKING } from "./constants";
import { isRouterTier } from "./guards";

const isAllowedThinking = (value: string): value is ThinkingLevel =>
  (ALLOWED_THINKING as readonly string[]).includes(value);

/** tier 없는 위임(`@router`)이 따라가는 기본 tier. */
export const DELEGATION_DEFAULT_TIER: RouterTier = "medium";

export interface ParsedDelegatedRef {
  router: string;
  tier: RouterTier;
  effort?: ThinkingLevel;
}

/**
 * `@` 뒤의 위임 참조를 파싱함: `router` / `router#tier` / `router#tier#effort`.
 * tier 생략 시 기본 티어(medium)를 따라감.
 */
export const parseDelegatedRef = (raw: string): ParsedDelegatedRef | undefined => {
  const parts = raw.split("#");
  if (parts.length > 3) return undefined;
  const router = parts[0]!.trim();
  if (!router) return undefined;
  if (parts.length === 1) return { router, tier: DELEGATION_DEFAULT_TIER };
  const tier = parts[1]!.trim();
  if (!isRouterTier(tier)) return undefined;
  if (parts.length === 2) return { router, tier };
  const effort = parts[2]!.trim();
  return isAllowedThinking(effort) ? { router, tier, effort } : undefined;
};

export const parseCanonicalModelRef = (
  value: string,
): { provider: string; modelId: string; effort?: ThinkingLevel } => {
  const hashIndex = value.indexOf("#");
  const rawRef = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const effortRaw = hashIndex === -1 ? undefined : value.slice(hashIndex + 1).trim();
  const slashIndex = rawRef.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid model reference "${value}". Expected "provider/model[#effort]".`);
  }
  const provider = rawRef.slice(0, slashIndex).trim();
  const modelId = rawRef.slice(slashIndex + 1).trim();
  if (!provider || !modelId) {
    throw new Error(`Invalid model reference "${value}". Expected "provider/model[#effort]".`);
  }
  if (effortRaw === undefined || effortRaw === "") {
    return { provider, modelId };
  }
  if (!isAllowedThinking(effortRaw)) {
    throw new Error(
      `Invalid effort "${effortRaw}": expected one of ${ALLOWED_THINKING.join(", ")}.`,
    );
  }
  return { provider, modelId, effort: effortRaw };
};

export const formatModelRef = (
  provider: string,
  modelId: string,
  effort?: ThinkingLevel,
): string => (effort ? `${provider}/${modelId}#${effort}` : `${provider}/${modelId}`);
