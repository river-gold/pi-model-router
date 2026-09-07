import type { RouterTier, TierGuides } from "../types";
import { isObjectRecord, isRouterTier } from "./guards";

export const TIER_GUIDE_ORDER: readonly RouterTier[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const DEFAULT_TIER_GUIDES: Record<RouterTier, string> = {
  minimal:
    "Mechanical transforms with no judgment: format, typo, rename, indent, template fill, quote-from-context.",
  low: "Cheap language/lookup work: summaries, changelogs, commit messages, quick explanations, small bounded transforms, simple read-only lookup.",
  medium:
    "Execute a known plan: spec-following implementation, multi-file edits, focused debugging with known cause, tests/fixes, routine wiring.",
  high: "Local design under uncertainty: module architecture, planning, tradeoff analysis, broad debugging, large refactors, codebase research.",
  xhigh:
    "Cross-cutting or high-blast-radius work: migrations, ambiguous RCA, security-sensitive changes, multi-repo/system design, risky refactors.",
  max: "Novel or irreversible work: greenfield strategy, adversarial audit, long-horizon research with conflicting sources, eval/algorithm invention.",
};

export const normalizeTierGuides = (
  raw: unknown,
  contextLabel = "tierGuides",
): TierGuides | undefined => {
  if (raw === undefined) return undefined;
  if (!isObjectRecord(raw)) {
    throw new Error(`Invalid ${contextLabel}: expected an object map of tier to description.`);
  }
  const out: TierGuides = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRouterTier(key)) {
      throw new Error(
        `Invalid ${contextLabel}: unknown tier "${key}". Expected one of minimal, low, medium, high, xhigh, max.`,
      );
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Invalid ${contextLabel}["${key}"]: expected non-blank string.`);
    }
    out[key] = value.trim();
  }
  return out;
};

export const mergeTierGuides = (
  base?: TierGuides,
  override?: TierGuides,
): TierGuides | undefined => {
  if (!base && !override) return undefined;
  if (!base) return { ...override };
  if (!override) return { ...base };
  const merged: TierGuides = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) {
      (merged as Record<string, string>)[key] = value as string;
    }
  }
  return merged;
};

export const buildClassifierSystemPrompt = (guides?: TierGuides): string => {
  const lines = TIER_GUIDE_ORDER.map(
    (tier) => `- ${tier}: ${guides?.[tier] ?? DEFAULT_TIER_GUIDES[tier]}`,
  );
  return `You are a model router classifier. Your job is to categorize the user's latest request into one of six tiers: "minimal", "low", "medium", "high", "xhigh", or "max".

Tiers:
${lines.join("\n")}

Do not answer the user's request. Do not use tools.
Return ONLY one word: minimal|low|medium|high|xhigh|max. No other text.`;
};
