import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterTier, TierGuides, TypesafeClassifierConfig } from "../types";
import { logClassifierSync } from "../logger";
import {
  DEFAULT_TYPESAFE_CONFIDENCE_THRESHOLD,
  TYPESAFE_ABORT_ERROR,
  classifyWithTypesafe,
} from "../typesafe";
import type { ClassifierAttempt } from "../classifier";

export const typesafeLabel = (model: string): string => `typesafe/${model}`;

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
 * TypeSafe System One 체인 항목 실행 (`@@typesafe/<model>`).
 * 실패하면 error를 돌려주고, 호출자가 체인의 다음 항목으로 폴백함.
 */
export const runTypesafeEntry = async (
  entry: TypesafeClassifierConfig,
  state: {
    currentConfig: {
      typesafeConfidenceThreshold?: number;
      tierGuides?: TierGuides;
    };
    lastExtensionContext: ExtensionContext | undefined;
  },
  context: Context,
  historySize: number,
  signal: AbortSignal | undefined,
): Promise<
  { result: { tier: RouterTier; reasoning: string } } | { attempt: ClassifierAttempt }
> => {
  const label = typesafeLabel(entry.model);
  if (signal?.aborted) throw new Error(TYPESAFE_ABORT_ERROR);
  setWorkingMessage(state.lastExtensionContext, `Classifying via TypeSafe (${entry.model})...`);
  const outcome = await classifyWithTypesafe({
    context,
    model: entry.model,
    historySize,
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
      model: label,
      fullText: "",
      success: false,
      error: outcome.error,
    });
    return { attempt: { model: label, error: outcome.error } };
  }
  logClassifierSync({
    timestamp: new Date().toISOString(),
    model: label,
    fullText: JSON.stringify({
      tier: outcome.result.tier,
      confidence: outcome.result.confidence,
      probabilities: outcome.result.probabilities,
    }),
    parsedTier: outcome.result.tier,
    reasoningLine: outcome.result.reasoning,
    success: true,
  });
  return { result: { tier: outcome.result.tier, reasoning: outcome.result.reasoning } };
};
