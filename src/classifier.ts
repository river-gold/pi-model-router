/* oxlint-disable */
import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterTier } from "./types";
import { parseCanonicalModelRef, isRouterTier } from "./config";
import { getLastUserText, getHistoryPairsText } from "./context";
import { logClassifierSync } from "./logger";
import { modelWithAuthBaseUrl, streamDelegated } from "./stream";

export const CLASSIFIER_SYSTEM_PROMPT = `You are a model router classifier. Your job is to categorize the user's latest request into one of six tiers: "minimal", "low", "medium", "high", "xhigh", or "max".

Tiers:
- minimal: Mechanical transforms with no judgment: format, typo, rename, indent, template fill, quote-from-context.
- low: Cheap language/lookup work: summaries, changelogs, commit messages, quick explanations, small bounded transforms, simple read-only lookup.
- medium: Execute a known plan: spec-following implementation, multi-file edits, focused debugging with known cause, tests/fixes, routine wiring.
- high: Local design under uncertainty: module architecture, planning, tradeoff analysis, broad debugging, large refactors, codebase research.
- xhigh: Cross-cutting or high-blast-radius work: migrations, ambiguous RCA, security-sensitive changes, multi-repo/system design, risky refactors.
- max: Novel or irreversible work: greenfield strategy, adversarial audit, long-horizon research with conflicting sources, eval/algorithm invention.

Do not answer the user's request. Do not use tools.
Return ONLY one word: minimal|low|medium|high|xhigh|max. No other text.`;

const OUTPUT_CONSTRAINT =
  "Classify the latest user message. Output ONLY one word: minimal|low|medium|high|xhigh|max. No other text.";

export const parseClassifierOutput = (
  fullText: string,
):
  | {
      tier: RouterTier;
      reasoning: string;
      tierLine: string;
      reasoningLine?: string;
    }
  | undefined => {
  const trimmed = fullText.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!isRouterTier(trimmed)) return undefined;
  return {
    tier: trimmed,
    reasoning: "Classifier decision.",
    tierLine: trimmed,
  };
};

// Simplified overload: historySizeOrThinking accepts number (historySize) or
// ThinkingLevel (thinking only, historySize=0). New optional signal param allows
// caller (provider) to propagate AbortSignal for cancellation/timeout.
export type ClassifierAttempt = {
  model: string;
  thinking?: ThinkingLevel;
  error?: string;
};

export const runClassifierWithFallbacksDetailed = async (
  classifierModels: {
    model: string;
    thinking?: ThinkingLevel;
    source?: string;
  }[],
  modelRegistry: ExtensionContext["modelRegistry"],
  context: Context,
  historySize: number,
  signal?: AbortSignal,
  onAttempt?: (entry: { model: string; thinking?: ThinkingLevel; source?: string }) => void,
  failedSet?: Set<string>,
): Promise<{
  result?: { tier: RouterTier; reasoning: string };
  attempts: ClassifierAttempt[];
}> => {
  const attempts: ClassifierAttempt[] = [];
  for (const entry of classifierModels) {
    const normalizedRef = entry.model.trim();
    if (failedSet?.has(normalizedRef)) {
      attempts.push({
        model: entry.model,
        thinking: entry.thinking,
        error: "skipped: failed this session (chain-local)",
      });
      continue;
    }
    onAttempt?.(entry);
    const outcome = await runClassifierOutcome(
      entry.model,
      modelRegistry,
      context,
      historySize,
      entry.thinking,
      signal,
    );
    if (outcome.result)
      return {
        result: outcome.result,
        attempts: [...attempts, { model: entry.model, thinking: entry.thinking }],
      };
    attempts.push({
      model: entry.model,
      thinking: entry.thinking,
      // outcome.error is always defined when result is missing (see runClassifierOutcome)
      error: outcome.error as string,
    });
    // Auth/stream/not-found skip the model for the rest of the session.
    // Parse-only failures are retried next turn (models often ignore format once then recover).
    if (outcome.skipSession) failedSet?.add(normalizedRef);
  }
  return { attempts };
};

type ClassifierOutcome = {
  result?: { tier: RouterTier; reasoning: string };
  skipSession: boolean;
  error?: string;
};

const runClassifierOutcome = async (
  classifierModelRef: string,
  modelRegistry: ExtensionContext["modelRegistry"],
  context: Context,
  historySize: number = 0,
  thinking?: ThinkingLevel,
  signal?: AbortSignal,
): Promise<ClassifierOutcome> => {
  const effectiveHistorySize = historySize;
  try {
    const { provider, modelId } = parseCanonicalModelRef(classifierModelRef);
    const model = modelRegistry.find(provider, modelId);
    if (!model) {
      const error = `model not found: ${provider}/${modelId}`;
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText: "",
        success: false,
        error,
      });
      return { skipSession: true, error };
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !("apiKey" in auth) || !auth.apiKey) {
      const error = `auth failed: ok=${auth.ok} hasKey=${"apiKey" in auth ? !!auth.apiKey : false}`;
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText: "",
        success: false,
        error,
      });
      return { skipSession: true, error };
    }
    const apiKey = (auth as { apiKey: string }).apiKey;
    const headers = auth.headers;
    const requestModel = modelWithAuthBaseUrl(model, auth as { baseUrl?: string });

    const promptText = getLastUserText(context);
    let body: string;
    if (effectiveHistorySize > 0) {
      const historyText = getHistoryPairsText(context, effectiveHistorySize);
      body = historyText
        ? `Recent history (user+final result pairs):\n${historyText}\n\nLatest user message:\n${promptText}`.trim()
        : `Latest user message:\n${promptText}`.trim();
    } else {
      body = `Latest user message:\n${promptText}`.trim();
    }
    const classifierUserPrompt = `${OUTPUT_CONSTRAINT}\n\n${body}`;

    const classifierContext: Context = {
      ...context,
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      tools: undefined,
      messages: [{ role: "user", content: classifierUserPrompt, timestamp: Date.now() }],
    };

    const reasoningOption =
      model.reasoning && thinking && thinking !== "off" ? thinking : undefined;

    const stream = streamDelegated(modelRegistry, requestModel, classifierContext, {
      apiKey,
      headers,
      ...(reasoningOption ? { reasoning: reasoningOption } : {}),
      ...(signal ? { signal } : {}),
    });
    let fullText = "";
    for await (const event of stream) {
      if (event.type === "text_delta" && "delta" in event && typeof event.delta === "string") {
        fullText += event.delta;
      }
    }

    const parsed = parseClassifierOutput(fullText);
    if (parsed) {
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText,
        tierLine: parsed.tierLine,
        reasoningLine: parsed.reasoningLine,
        parsedTier: parsed.tier,
        success: true,
      });
      return {
        result: { tier: parsed.tier, reasoning: parsed.reasoning },
        skipSession: false,
      };
    }
    const parseError = "no tier parsed or isRouterTier false";
    logClassifierSync({
      timestamp: new Date().toISOString(),
      model: classifierModelRef,
      thinking,
      fullText,
      success: false,
      error: parseError,
    });
    return { skipSession: false, error: parseError };
  } catch (e) {
    if (signal?.aborted) {
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText: "",
        success: false,
        error: "aborted",
      });
      return { skipSession: false, error: "aborted" };
    }
    const error = e instanceof Error ? e.message : String(e);
    logClassifierSync({
      timestamp: new Date().toISOString(),
      model: classifierModelRef,
      thinking,
      fullText: "",
      success: false,
      error,
    });
    return { skipSession: true, error };
  }
};
