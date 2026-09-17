import type { TierGuides } from "../types";
import { DEFAULT_TIER_GUIDES, TIER_GUIDE_ORDER } from "../config/tierGuides";
import { TYPESAFE_TIER_QUESTION_ID } from "./constants";
import type { TypesafeRequest, TypesafeState } from "./types";

const INSTRUCTIONS =
  "Classify the work the user is asking for in `message`. Use `history` only as background context and judge `message` itself. Choose the single tier whose description best matches the effort the request needs.";

/** tierGuides가 있으면 선택지 설명으로 그대로 쓰고, 없으면 내장 설명을 씀. */
export const buildTypesafeRequest = (
  state: TypesafeState,
  model: string,
  guides?: TierGuides,
): TypesafeRequest => {
  const criteria: Record<string, string> = {};
  for (const tier of TIER_GUIDE_ORDER) {
    criteria[tier] = guides?.[tier] ?? DEFAULT_TIER_GUIDES[tier];
  }
  return {
    state,
    model,
    questions: {
      [TYPESAFE_TIER_QUESTION_ID]: { type: "choice", instructions: INSTRUCTIONS, criteria },
    },
  };
};
