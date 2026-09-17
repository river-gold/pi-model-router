import type { RouterTier } from "../types";
import { TIER_GUIDE_ORDER } from "../config/tierGuides";
import type { TypesafeClassification } from "./types";

export interface ConfidenceGate {
  tier: RouterTier;
  reasoning: string;
}

const formatConfidence = (confidence: number | undefined): string =>
  confidence === undefined ? "confidence unavailable" : `confidence ${confidence.toFixed(2)}`;

/**
 * Confidence-Gated Routing: 확신이 낮으면 한 단계 위 tier로 승격함.
 * 확신이 없으면 더 강한 모델을 쓰는 쪽이 안전하고, 상한은 max tier임.
 */
export const applyConfidenceGate = (
  classification: TypesafeClassification,
  threshold: number,
): ConfidenceGate => {
  const { tier, confidence } = classification;
  const description = `TypeSafe chose ${tier} (${formatConfidence(confidence)}).`;
  if (confidence === undefined || confidence >= threshold) return { tier, reasoning: description };
  const index = TIER_GUIDE_ORDER.indexOf(tier);
  if (index >= TIER_GUIDE_ORDER.length - 1) {
    return {
      tier,
      reasoning: `TypeSafe chose ${tier} (${formatConfidence(confidence)} < ${threshold}, already the highest tier).`,
    };
  }
  const escalated = TIER_GUIDE_ORDER[index + 1]!;
  return {
    tier: escalated,
    reasoning: `TypeSafe chose ${tier} (${formatConfidence(confidence)} < ${threshold}) → escalated to ${escalated}.`,
  };
};
