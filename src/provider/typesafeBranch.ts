import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterTier, TierGuides } from "../types";
import { logClassifierSync } from "../logger";
import {
  DEFAULT_TYPESAFE_CONFIDENCE_THRESHOLD,
  TYPESAFE_ABORT_ERROR,
  TYPESAFE_MODEL,
  classifyWithTypesafe,
} from "../typesafe";

export const TYPESAFE_CLASSIFIER_LABEL = `typesafe/${TYPESAFE_MODEL}`;

const setWorkingMessage = (
  context: ExtensionContext | undefined,
  message: string | undefined,
): void => {
  try {
    context?.ui.setWorkingMessage(message);
  } catch {
    // stale context
  }
};

/**
 * TypeSafe System One 분류기 (typesafeClassifier:true).
 * 실패하면 undefined를 반환해서 호출자가 기존 기본 tier를 유지하게 함 (LLM 분류기 폴백 없음).
 */
export const runTypesafeBranch = async (
  state: {
    currentConfig: {
      typesafeConfidenceThreshold?: number;
      historySize?: number;
      tierGuides?: TierGuides;
    };
    lastExtensionContext: ExtensionContext | undefined;
  },
  context: Context,
  signal: AbortSignal | undefined,
): Promise<{ tier: RouterTier; reasoning: string } | undefined> => {
  if (signal?.aborted) throw new Error(TYPESAFE_ABORT_ERROR);
  setWorkingMessage(state.lastExtensionContext, `Classifying via TypeSafe (${TYPESAFE_MODEL})...`);
  const outcome = await classifyWithTypesafe({
    context,
    historySize: state.currentConfig.historySize ?? 0,
    confidenceThreshold:
      state.currentConfig.typesafeConfidenceThreshold ?? DEFAULT_TYPESAFE_CONFIDENCE_THRESHOLD,
    tierGuides: state.currentConfig.tierGuides,
    signal,
  });
  setWorkingMessage(state.lastExtensionContext, undefined);
  if ("error" in outcome) {
    if (outcome.error === TYPESAFE_ABORT_ERROR) throw new Error(TYPESAFE_ABORT_ERROR);
    logClassifierSync({
      timestamp: new Date().toISOString(),
      model: TYPESAFE_CLASSIFIER_LABEL,
      fullText: "",
      success: false,
      error: outcome.error,
    });
    return undefined;
  }
  logClassifierSync({
    timestamp: new Date().toISOString(),
    model: TYPESAFE_CLASSIFIER_LABEL,
    fullText: JSON.stringify({
      tier: outcome.result.tier,
      confidence: outcome.result.confidence,
      probabilities: outcome.result.probabilities,
    }),
    parsedTier: outcome.result.tier,
    reasoningLine: outcome.result.reasoning,
    success: true,
  });
  return { tier: outcome.result.tier, reasoning: outcome.result.reasoning };
};
