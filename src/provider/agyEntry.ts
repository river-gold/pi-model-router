import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterTier, TierGuides, AgyClassifierConfig } from "../types";
import { logClassifierSync } from "../logger";
import { AGY_ABORT_ERROR } from "../agy/pool";
import { classifyWithAgy } from "../agy/classify";
import type { ClassifierAttempt } from "../classifier";

export const agyLabel = (entry: AgyClassifierConfig): string =>
  `agy/${entry.model}${entry.effort ? `#${entry.effort}` : ""}`;

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
 * agy 체인 항목 실행 (`@@agy/<model>[:<effort>]`).
 * 실패하면 error를 돌려주고, 호출자가 체인의 다음 항목으로 폴백함.
 */
export const runAgyEntry = async (
  entry: AgyClassifierConfig,
  state: {
    currentConfig: {
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
  const label = agyLabel(entry);
  if (signal?.aborted) throw new Error(AGY_ABORT_ERROR);
  setWorkingMessage(state.lastExtensionContext, `Classifying via agy (${label})...`);
  const outcome = await classifyWithAgy({
    context,
    model: entry.model,
    effort: entry.effort,
    historySize,
    tierGuides: state.currentConfig.tierGuides,
    signal,
    cwd: state.lastExtensionContext?.cwd ?? process.cwd(),
  });
  setWorkingMessage(state.lastExtensionContext, undefined);
  if ("error" in outcome) {
    if (outcome.error === AGY_ABORT_ERROR) throw new Error(AGY_ABORT_ERROR);
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
    fullText: outcome.result.tier,
    parsedTier: outcome.result.tier,
    reasoningLine: outcome.result.reasoning,
    success: true,
  });
  return { result: { tier: outcome.result.tier, reasoning: outcome.result.reasoning } };
};
