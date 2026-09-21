import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Router, ClassifierModelsSetting, RouterTier, TierGuides } from "../types";
import {
  resolveEffectiveClassifier,
  isTypesafeClassifierConfig,
  isAgyClassifierConfig,
} from "../config";
import { runClassifierWithFallbacksDetailed, type ClassifierAttempt } from "../classifier";
import { runTypesafeEntry } from "./typesafeEntry";
import { runAgyEntry } from "./agyEntry";
import { CLASSIFIER_CHAIN_KEY } from "../failureMemory";

// runClassifierBranch matches task signature: (registry, router, state, context, signal, effectiveHistorySize, failedSet, classifierSource) -> {result, attempts}
export const runClassifierBranch = async (
  registry: ExtensionContext["modelRegistry"],
  router: Router,
  state: {
    currentConfig: {
      classifierModels?: ClassifierModelsSetting | undefined;
      historySize?: number;
      tierGuides?: TierGuides;
    };
    failedByChain: Map<string, Set<string>>;
    lastExtensionContext: ExtensionContext | undefined;
  },
  context: Context,
  signal: AbortSignal | undefined,
  effectiveHistorySize: number,
  failedSet: Set<string>,
  classifierSource: string,
  sessionId?: string,
  routerName?: string,
  routers?: Record<string, Router>,
): Promise<{
  result: { tier: RouterTier; reasoning: string } | undefined;
  attempts: ClassifierAttempt[];
}> => {
  const { classifiers: effectiveClassifiers } = resolveEffectiveClassifier(
    router,
    state.currentConfig.classifierModels,
    routers,
  );
  if (!effectiveClassifiers) {
    throw new Error(
      "No classifier available for auto (off) mode. Configure classifierModels or add a low tier.",
    );
  }
  if (signal?.aborted) throw new Error("aborted");
  const attempts: ClassifierAttempt[] = [];
  const onAttempt = (entry: { model: string; effort?: ThinkingLevel; source?: string }): void => {
    try {
      state.lastExtensionContext?.ui.setWorkingMessage(
        `Classifying via ${entry.source ?? classifierSource} (${entry.model}${entry.effort ? `#${entry.effort}` : ""})...`,
      );
    } catch {
      // stale
    }
  };
  let result: { tier: RouterTier; reasoning: string } | undefined;
  // 체인 순서대로 시도하고, 실패한 항목은 attempts에 남긴 뒤 다음 항목으로 폴백함.
  for (const entry of effectiveClassifiers) {
    if (signal?.aborted) throw new Error("aborted");
    if (isTypesafeClassifierConfig(entry)) {
      const outcome = await runTypesafeEntry(entry, state, context, effectiveHistorySize, signal);
      if ("result" in outcome) {
        result = outcome.result;
        break;
      }
      attempts.push(outcome.attempt);
      continue;
    }
    if (isAgyClassifierConfig(entry)) {
      const outcome = await runAgyEntry(entry, state, context, effectiveHistorySize, signal);
      if ("result" in outcome) {
        result = outcome.result;
        break;
      }
      attempts.push(outcome.attempt);
      continue;
    }
    const llm = await runClassifierWithFallbacksDetailed(
      [entry],
      registry,
      context,
      effectiveHistorySize,
      signal,
      onAttempt,
      failedSet,
      state.currentConfig.tierGuides,
      sessionId,
    );
    attempts.push(...llm.attempts);
    if (llm.result) {
      result = llm.result;
      break;
    }
  }
  if (failedSet.size > 0) state.failedByChain.set(CLASSIFIER_CHAIN_KEY, failedSet);
  try {
    state.lastExtensionContext?.ui.setWorkingMessage(undefined);
  } catch {
    // stale
  }
  if (result) return { result, attempts };
  const attempted = attempts
    .map((a) => `${a.model}${a.effort ? `#${a.effort}` : ""} (${a.error})`)
    .join(", ");
  throw new Error(
    `Classifier failed to determine a tier. Source: ${classifierSource}. Attempted: ${attempted || "none"}. Models may be unregistered, missing API keys, or returned invalid format (expected "Tier: minimal|low|medium|high|xhigh|max").`,
  );
};
