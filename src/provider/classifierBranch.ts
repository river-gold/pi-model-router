import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile } from "../types";
import { resolveEffectiveClassifier } from "../config";
import { runClassifierWithFallbacksDetailed } from "../classifier";
import { CLASSIFIER_CHAIN_KEY } from "../failureMemory";

// runClassifierBranch matches task signature: (registry, profile, state, context, signal, effectiveHistorySize, failedSet, classifierSource) -> {result, attempts}
export const runClassifierBranch = async (
  registry: ExtensionContext["modelRegistry"],
  profile: RouterProfile,
  state: {
    currentConfig: { classifierModels?: import("../types").ClassifierConfig[]; historySize?: number };
    failedByChain: Map<string, Set<string>>;
    lastExtensionContext: ExtensionContext | undefined;
  },
  context: Context,
  signal: AbortSignal | undefined,
  effectiveHistorySize: number,
  failedSet: Set<string>,
  classifierSource: string,
): Promise<{
  result: { tier: import("../types").RouterTier; reasoning: string } | undefined;
  attempts: import("../classifier").ClassifierAttempt[];
}> => {
  const { classifiers: effectiveClassifiers } = resolveEffectiveClassifier(
    profile,
    state.currentConfig.classifierModels,
  );
  if (!effectiveClassifiers) {
    throw new Error(
      "No classifier available for auto (off) mode. Configure classifierModels or add a low tier.",
    );
  }
  if (signal?.aborted) throw new Error("aborted");
  const { result, attempts } = await runClassifierWithFallbacksDetailed(
    effectiveClassifiers,
    registry,
    context,
    effectiveHistorySize,
    signal,
    (entry) => {
      try {
        state.lastExtensionContext?.ui.setWorkingMessage(
          `Classifying via ${entry.source ?? classifierSource} (${entry.model}${entry.thinking ? `#${entry.thinking}` : ""})...`,
        );
      } catch {
        // stale
      }
    },
    failedSet,
  );
  if (failedSet.size > 0) state.failedByChain.set(CLASSIFIER_CHAIN_KEY, failedSet);
  try {
    state.lastExtensionContext?.ui.setWorkingMessage(undefined);
  } catch {
    // stale
  }
  if (result) return { result, attempts };
  const attempted = attempts
    .map((a) => `${a.model}${a.thinking ? `#${a.thinking}` : ""} (${a.error})`)
    .join(", ");
  throw new Error(
    `Classifier failed to determine a tier. Source: ${classifierSource}. Attempted: ${attempted || "none"}. Models may be unregistered, missing API keys, or returned invalid format (expected "Tier: minimal|low|medium|high|xhigh|max").`,
  );
};
