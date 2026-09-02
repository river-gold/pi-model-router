import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
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

const PARSE_ERROR = "no tier parsed or isRouterTier false";
const ABORT_ERROR = "aborted";

export const ClassifierSkip = {
  SKIP: true,
  RETRY: false,
} as const;

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
  historySize = 0,
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
    if (outcome.result) {
      return {
        result: outcome.result,
        attempts: [...attempts, { model: entry.model, thinking: entry.thinking }],
      };
    }
    attempts.push({
      model: entry.model,
      thinking: entry.thinking,
      error: outcome.error,
    });
    if (outcome.skipSession) failedSet?.add(normalizedRef);
  }
  return { attempts };
};

type ClassifierOutcome =
  | {
      result: { tier: RouterTier; reasoning: string };
      skipSession: boolean;
    }
  | {
      result?: undefined;
      skipSession: boolean;
      error: string;
    };

const resolveClassifierModel = (
  registry: ExtensionContext["modelRegistry"],
  ref: string,
): { model: ReturnType<ExtensionContext["modelRegistry"]["find"]> } | { error: string } => {
  const { provider, modelId } = parseCanonicalModelRef(ref);
  const model = registry.find(provider, modelId);
  if (!model) return { error: `model not found: ${provider}/${modelId}` };
  return { model };
};

const fetchClassifierAuth = async (
  registry: ExtensionContext["modelRegistry"],
  model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>,
): Promise<
  | { apiKey: string; headers: Record<string, string>; requestModel: typeof model }
  | { error: string }
> => {
  const auth = await registry.getApiKeyAndHeaders(model);
  const hasKey =
    "apiKey" in (auth as Record<string, unknown>) && !!(auth as { apiKey: string }).apiKey;
  if (!auth.ok || !hasKey) {
    return { error: `auth failed: ok=${auth.ok} hasKey=${hasKey}` };
  }
  const apiKey = (auth as { apiKey: string }).apiKey;
  const headers = (auth as { headers: Record<string, string> }).headers;
  const requestModel = modelWithAuthBaseUrl(
    model as unknown as { baseUrl: string } & typeof model,
    auth as { baseUrl?: string },
  ) as typeof model;
  return { apiKey, headers, requestModel };
};

const buildClassifierPromptBody = (context: Context, historySize: number): string => {
  const promptText = getLastUserText(context);
  if (historySize <= 0) return `Latest user message:\n${promptText}`.trim();
  const historyText = getHistoryPairsText(context, historySize);
  if (historyText)
    return `Recent history (user+final result pairs):\n${historyText}\n\nLatest user message:\n${promptText}`.trim();
  return `Latest user message:\n${promptText}`.trim();
};

const buildClassifierContext = (context: Context, historySize: number): Context => {
  const body = buildClassifierPromptBody(context, historySize);
  return {
    ...context,
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    tools: undefined,
    messages: [{ role: "user", content: `${OUTPUT_CONSTRAINT}\n\n${body}`, timestamp: Date.now() }],
  };
};

const resolveReasoningOption = (
  model: { reasoning?: unknown },
  thinking?: ThinkingLevel,
): ThinkingLevel | undefined => {
  if (!model.reasoning) return undefined;
  if (!thinking) return undefined;
  if (thinking === "off") return undefined;
  return thinking;
};

const isTextDeltaEvent = (event: unknown): event is { type: string; delta: string } => {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;
  return e.type === "text_delta" && "delta" in e && typeof e.delta === "string";
};

const collectStreamText = async (stream: AsyncIterable<unknown>): Promise<string> => {
  let fullText = "";
  for await (const event of stream) {
    if (isTextDeltaEvent(event)) fullText += event.delta;
  }
  return fullText;
};

const runClassifierOutcome = async (
  classifierModelRef: string,
  modelRegistry: ExtensionContext["modelRegistry"],
  context: Context,
  historySize = 0,
  thinking?: ThinkingLevel,
  signal?: AbortSignal,
): Promise<ClassifierOutcome> => {
  try {
    const modelResolution = resolveClassifierModel(modelRegistry, classifierModelRef);
    if ("error" in modelResolution) {
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText: "",
        success: false,
        error: modelResolution.error,
      });
      return { skipSession: ClassifierSkip.SKIP, error: modelResolution.error };
    }
    const model = modelResolution.model as NonNullable<typeof modelResolution.model>;

    const authResolution = await fetchClassifierAuth(modelRegistry, model);
    if ("error" in authResolution) {
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText: "",
        success: false,
        error: authResolution.error,
      });
      return { skipSession: ClassifierSkip.SKIP, error: authResolution.error };
    }

    const classifierContext = buildClassifierContext(context, historySize);
    const reasoningOption = resolveReasoningOption(model as { reasoning?: unknown }, thinking);

    const stream = streamDelegated(modelRegistry, model, classifierContext, {
      apiKey: authResolution.apiKey,
      headers: authResolution.headers,
      ...(reasoningOption
        ? { reasoning: reasoningOption as unknown as SimpleStreamOptions["reasoning"] }
        : {}),
      ...(signal ? { signal } : {}),
    } as SimpleStreamOptions);

    const fullText = await collectStreamText(stream);

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
        skipSession: ClassifierSkip.RETRY,
      };
    }

    logClassifierSync({
      timestamp: new Date().toISOString(),
      model: classifierModelRef,
      thinking,
      fullText,
      success: false,
      error: PARSE_ERROR,
    });
    return { skipSession: ClassifierSkip.RETRY, error: PARSE_ERROR };
  } catch (e) {
    if (signal?.aborted) {
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: classifierModelRef,
        thinking,
        fullText: "",
        success: false,
        error: ABORT_ERROR,
      });
      return { skipSession: ClassifierSkip.RETRY, error: ABORT_ERROR };
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
    return { skipSession: ClassifierSkip.SKIP, error };
  }
};
