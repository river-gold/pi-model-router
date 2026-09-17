import { isObjectRecord, isRouterTier } from "../config/guards";
import { TYPESAFE_TIER_QUESTION_ID } from "./constants";
import type { TypesafeClassification, TypesafeOutcome } from "./types";

const readConfidence = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;

const readProbabilities = (raw: unknown): Record<string, number> | undefined => {
  if (!isObjectRecord(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [option, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) out[option] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export const parseTypesafeResponse = (raw: unknown): TypesafeOutcome<TypesafeClassification> => {
  if (!isObjectRecord(raw)) return { error: "Response is not a JSON object." };
  if (!isObjectRecord(raw.answers)) return { error: 'Response has no "answers" object.' };
  const answer = raw.answers[TYPESAFE_TIER_QUESTION_ID];
  if (!isObjectRecord(answer)) {
    return { error: `Response has no answer for "${TYPESAFE_TIER_QUESTION_ID}".` };
  }
  if (answer.type !== "choice") {
    return { error: `Answer "${TYPESAFE_TIER_QUESTION_ID}" is not a choice answer.` };
  }
  const tier = answer.choice;
  if (!isRouterTier(tier)) {
    return {
      error: `Answer "${TYPESAFE_TIER_QUESTION_ID}" returned an unknown tier: ${JSON.stringify(tier)}.`,
    };
  }
  return {
    result: {
      tier,
      confidence: readConfidence(answer.confidence),
      probabilities: readProbabilities(answer.probabilities),
    },
  };
};
