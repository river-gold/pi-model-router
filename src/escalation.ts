import { Type } from "typebox";
import { isRouterTier } from "./config";
import type { RouterTier } from "./types";

export const TIER_HINT =
  "minimal: format/typo, low: summary/lookup, medium: spec implement, high: design/tradeoff, xhigh: migration/security, max: greenfield/audit";

export const ESCALATION_TOOL_NAME = "set_reasoning_effort";

export const ESCALATION_TOOL = {
  name: ESCALATION_TOOL_NAME,
  description: `Current tier is insufficient or excessive — call to retry the same prompt at a different tier. Only works once per turn; current generation is fully discarded on call. Tiers: ${TIER_HINT}`,
  parameters: Type.Object({
    level: Type.Union([
      Type.Literal("minimal"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
      Type.Literal("max"),
    ]),
    reason: Type.Optional(Type.String()),
  }),
};

export const isEscalationCall = (name: string): boolean => name === ESCALATION_TOOL_NAME;

export const validateEscalationLevel = (raw: unknown): RouterTier | undefined => {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (isRouterTier(v)) return v;
  return undefined;
};
