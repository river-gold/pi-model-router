import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { Context, Message } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
  RouterTier,
  RouterPhase,
  RouterProfile,
  RoutingDecision,
  RoutingRule,
} from './types';
import { parseCanonicalModelRef, isRouterTier } from './config';
import { resolveDelegatedModel, type RegistryWithProviderAuth } from './constants';

export const extractTextFromContent = (
  content: string | Message['content'],
): string => {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') return part.thinking;
      if (part.type === 'toolCall')
        return `${part.name} ${JSON.stringify(part.arguments)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

export const getLastUserText = (context: Context): string => {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === 'user') {
      return extractTextFromContent(message.content).trim();
    }
  }
  return '';
};

export const getRecentConversationText = (
  context: Context,
  limit = 6,
): string => {
  return context.messages
    .slice(-limit)
    .map((message) => extractTextFromContent(message.content).trim())
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
};

export const countToolResults = (context: Context): number => {
  return context.messages.filter((message) => message.role === 'toolResult')
    .length;
};

export const countWords = (text: string): number => {
  return text.split(/\s+/).filter(Boolean).length;
};

export const hasImageAttachment = (context: Context): boolean => {
  return context.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image'),
  );
};

export const containsAny = (text: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => text.includes(keyword));
};

export const phaseForTier = (tier: RouterTier): RouterPhase => {
  if (tier === 'high') return 'planning';
  if (tier === 'medium') return 'implementation';
  return 'lightweight';
};

export const resolveAvailableTier = (
  profile: RouterProfile,
  preferred: RouterTier,
): RouterTier => {
  if (profile[preferred]) return preferred;
  // Fall "up": low → medium → high
  const order: RouterTier[] = ['low', 'medium', 'high'];
  const startIdx = order.indexOf(preferred);
  for (let i = startIdx + 1; i < order.length; i++) {
    if (profile[order[i]]) return order[i];
  }
  // Fall "down" as last resort
  for (let i = startIdx - 1; i >= 0; i--) {
    if (profile[order[i]]) return order[i];
  }
  return preferred; // unreachable if profile has ≥1 tier
};

export const buildRoutingDecision = (
  profileName: string,
  profile: RouterProfile,
  tier: RouterTier,
  phase: RouterPhase,
  reasoning: string,
  isClassifier?: boolean,
): RoutingDecision => {
  const routed = profile[tier];
  if (!routed) {
    throw new Error(`Profile "${profileName}" has no configuration for the ${tier} tier.`);
  }
  const { provider, modelId } = parseCanonicalModelRef(routed.model);
  const effectiveThinking =
    routed.thinking ??
    (tier === 'high' ? 'high' : tier === 'low' ? 'low' : 'medium');

  return {
    profile: profileName,
    tier,
    phase,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: routed.model,
    reasoning,
    thinking: effectiveThinking,
    timestamp: Date.now(),
    isClassifier,
  };
};

export const decideRouting = (
  context: Context,
  profileName: string,
  profile: RouterProfile,
  previousDecision: RoutingDecision | undefined,
  rules?: RoutingRule[],
): RoutingDecision => {
  const prompt = getLastUserText(context).toLowerCase();

  let phase: RouterPhase = previousDecision?.phase ?? 'implementation';
  let tier: RouterTier = 'medium';
  let reasoning = 'Defaulted to medium tier for general coding work.';
  let isRuleMatched = false;

  // Check custom rules first
  if (rules) {
    let highestTier: RouterTier | undefined;
    let winningRule: RoutingRule | undefined;
    const tierRank: Record<RouterTier, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };

    for (const rule of rules) {
      const matches = Array.isArray(rule.matches)
        ? rule.matches
        : [rule.matches];
      const lowercaseMatches = matches.map((m) => m.toLowerCase());
      if (containsAny(prompt, lowercaseMatches)) {
        if (!highestTier || tierRank[rule.tier] > tierRank[highestTier]) {
          highestTier = rule.tier;
          winningRule = rule;
        }
      }
    }

    if (winningRule && highestTier) {
      tier = highestTier;
      phase = phaseForTier(tier);
      const matches = Array.isArray(winningRule.matches)
        ? winningRule.matches
        : [winningRule.matches];
      reasoning =
        winningRule.reason ??
        `Matched custom routing rule for: ${matches.join(', ')}`;
      isRuleMatched = true;
    }
  }

  // Heuristics removed: when no custom rule matches,
  // keep the default medium tier. Classifier (if configured) may still
  // override afterwards in provider.ts.

  // Resolve to nearest available tier if the selected tier is disabled
  const resolvedTier = resolveAvailableTier(profile, tier);
  if (resolvedTier !== tier) {
    reasoning = `Resolved from ${tier} to ${resolvedTier} tier (${tier} tier is not configured). Original: ${reasoning}`;
    phase = phaseForTier(resolvedTier);
    tier = resolvedTier;
  }

  const decision = buildRoutingDecision(
    profileName,
    profile,
    tier,
    phase,
    reasoning,
    false,
  );
  decision.isRuleMatched = isRuleMatched;
  return decision;
};

export const CLASSIFIER_SYSTEM_PROMPT = `You are a model router classifier. Your job is to categorize the user's latest request into one of three tiers: "high", "medium", or "low".

Tiers:
- high: Architecture, design, planning, tradeoff analysis, broad debugging, large refactors, codebase research.
- medium: Implementation of a known plan, multi-file edits, normal coding work, focused debugging, tests/fixes.
- low: Summaries, changelogs, formatting, quick explanations, small bounded transforms, simple read-only lookup.

Return your decision in exactly two lines:
Tier: [high|medium|low]
Reasoning: [one short sentence]`;

export const runClassifier = async (
  classifierModelRef: string,
  modelRegistry: ExtensionContext['modelRegistry'],
  context: Context,
  currentPhase?: RouterPhase,
  thinking?: ThinkingLevel,
): Promise<{ tier: RouterTier; reasoning: string } | undefined> => {
  try {
    const { provider, modelId } = parseCanonicalModelRef(classifierModelRef);
    const model = modelRegistry.find(provider, modelId);
    if (!model) return undefined;

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;
    const apiKey = auth.apiKey;
    const headers = auth.headers;

    // getApiKeyAndHeaders() does not surface a credential-specific baseUrl.
    // Some OAuth providers (e.g. GitHub Copilot business/enterprise tenants)
    // resolve a per-token proxy endpoint that differs from the model's static
    // baseUrl; without applying it, this request fails with 421 Misdirected
    // Request.
    const requestModel = await resolveDelegatedModel(
      modelRegistry as unknown as RegistryWithProviderAuth,
      model,
    );

    const promptText = getLastUserText(context);
    const historyText = getRecentConversationText(context, 4);

    const classifierUserPrompt = `${currentPhase ? `Current conversation phase: ${currentPhase}\n` : ''}Recent history:
${historyText}

Latest user message:
${promptText}

${currentPhase === 'planning' ? 'Consider that the conversation is currently in a planning phase. Bias toward "high" unless the request is clearly a simple implementation or summary.' : ''}
${currentPhase === 'implementation' ? 'Consider that the conversation is currently in an implementation phase. Bias toward "medium" unless the request is clearly planning or a simple summary.' : ''}`.trim();

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
    });
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
        return {
          tier: tierValue,
          reasoning: reasoningLine
            ? reasoningLine.split(':')[1].trim()
            : 'Classifier decision.',
        };
      }
    }
  } catch (error) {
    // Ignore classifier errors and fall back to heuristics
  }
  return undefined;
};
