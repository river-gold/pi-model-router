import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { Context } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterTier } from './types';
import { parseCanonicalModelRef, isRouterTier } from './config';
import { resolveDelegatedModel, type RegistryWithProviderAuth } from './constants';
import { extractTextFromContent, getLastUserText, getHistoryPairsText } from './context';

export const CLASSIFIER_SYSTEM_PROMPT = `You are a model router classifier. Your job is to categorize the user's latest request into one of three tiers: "high", "medium", or "low".

Tiers:
- high: Architecture, design, planning, tradeoff analysis, broad debugging, large refactors, codebase research.
- medium: Implementation of a known plan, multi-file edits, normal coding work, focused debugging, tests/fixes.
- low: Summaries, changelogs, formatting, quick explanations, small bounded transforms, simple read-only lookup.

Return your decision in exactly two lines:
Tier: [high|medium|low]
Reasoning: [one short sentence]`;

// Simplified overload: historySizeOrThinking accepts number (historySize) or
// ThinkingLevel (thinking only, historySize=0). New optional signal param allows
// caller (provider) to propagate AbortSignal for cancellation/timeout.
export const runClassifier = async (
  classifierModelRef: string,
  modelRegistry: ExtensionContext['modelRegistry'],
  context: Context,
  historySizeOrThinking?: number | ThinkingLevel,
  thinkingMaybe?: ThinkingLevel,
  signal?: AbortSignal,
): Promise<{ tier: RouterTier; reasoning: string } | undefined> => {
  let historySize = 0;
  let thinking: ThinkingLevel | undefined = undefined;
  if (typeof historySizeOrThinking === 'number') {
    historySize = historySizeOrThinking;
    thinking = thinkingMaybe;
  } else if (typeof historySizeOrThinking === 'string') {
    thinking = historySizeOrThinking;
  }
  try {
    const { provider, modelId } = parseCanonicalModelRef(classifierModelRef);
    const model = modelRegistry.find(provider, modelId);
    if (!model) return undefined;

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;
    const apiKey = auth.apiKey;
    const headers = auth.headers;

    const requestModel = await resolveDelegatedModel(
      modelRegistry as unknown as RegistryWithProviderAuth,
      model,
    );

    const promptText = getLastUserText(context);
    let classifierUserPrompt: string;
    if (historySize > 0) {
      const historyText = getHistoryPairsText(context, historySize);
      classifierUserPrompt = historyText
        ? `Recent history (user+final result pairs):\n${historyText}\n\nLatest user message:\n${promptText}`.trim()
        : `Latest user message:\n${promptText}`.trim();
    } else {
      classifierUserPrompt = `Latest user message:\n${promptText}`.trim();
    }

    const classifierContext: Context = {
      ...context,
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      tools: undefined,
      messages: [{ role: 'user', content: classifierUserPrompt, timestamp: Date.now() }],
    };

    const reasoningOption =
      model.reasoning && thinking && thinking !== 'off'
        ? thinking
        : undefined;

    const stream = streamSimple(requestModel, classifierContext, {
      apiKey,
      headers,
      ...(reasoningOption ? { reasoning: reasoningOption } : {}),
      ...(signal ? { signal } : {}),
    } as unknown as Parameters<typeof streamSimple>[2]);
    let fullText = '';
    for await (const event of stream) {
      if (
        event.type === 'text_delta' &&
        'delta' in event &&
        typeof event.delta === 'string'
      ) {
        fullText += event.delta;
      }
    }

    const lines = fullText.trim().split('\n');
    const tierLine = lines.find((l) => l.toLowerCase().startsWith('tier:'));
    const reasoningLine = lines.find((l) =>
      l.toLowerCase().startsWith('reasoning:'),
    );

    if (tierLine) {
      const tierValue = tierLine.split(':')[1].trim().toLowerCase();
      if (isRouterTier(tierValue)) {
        const reasoningText = reasoningLine
          ? reasoningLine.substring(reasoningLine.indexOf(':') + 1).trim()
          : 'Classifier decision.';
        return {
          tier: tierValue,
          reasoning: reasoningText,
        };
      }
    }
  } catch (error) {
    // Classifier failure is non-fatal: caller falls back to medium tier.
    // Keep catch narrow; log at debug level when available for diagnostics.
    if (signal?.aborted) return undefined;
    // Avoid noisy logging in production; provider will continue with default tier.
    // Debug hint: error instanceof Error ? error.message : String(error)
    void error;
  }
  return undefined;
};
