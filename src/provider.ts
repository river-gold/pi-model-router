import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type Message,
} from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { RouterConfig, RoutingDecision, RouterTier } from './types';
import {
  profileNames,
  parseCanonicalModelRef,
  ROUTER_TIERS,
  resolveContextWindow,
  resolveMaxTokens,
  resolveDelegatedReasoning,
  resolveEffectiveClassifier,
} from './config';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  resolveDelegatedModel,
  type RegistryWithProviderAuth,
} from './constants';
import { embedText, normalizePromptForEmbedding } from './embeddings';
import { getVectorStore } from './vector-store';
// Hook for local providers like pi-agent-bridge to register without hardcoding.
// pi-agent-bridge can do: (globalThis as any).__piModelRouterLocalHandlers?.set("pi-agent-bridge://", handler)
const getLocalHandlers = (): Map<string, (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream> => {
  const g = globalThis as unknown as { __piModelRouterLocalHandlers?: Map<string, (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream> };
  if (!g.__piModelRouterLocalHandlers) g.__piModelRouterLocalHandlers = new Map();
  return g.__piModelRouterLocalHandlers;
};

export const registerLocalHandler = (
  prefix: string,
  handler: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream,
) => {
  getLocalHandlers().set(prefix, handler);
};

const REGISTRY_WAIT_TIMEOUT_MS = 5000;
const REGISTRY_WAIT_INITIAL_DELAY_MS = 50;
const REGISTRY_WAIT_MAX_DELAY_MS = 500;

/**
 * Wait for the model registry to become available with exponential backoff.
 * This handles the race condition where subagents (e.g. from pi-dynamic-workflows)
 * invoke the router provider before session_start has fired in their context.
 */
export const waitForRegistry = async (
  state: {
    readonly currentModelRegistry:
      | ExtensionContext['modelRegistry']
      | undefined;
  },
  timeoutMs: number = REGISTRY_WAIT_TIMEOUT_MS,
): Promise<ExtensionContext['modelRegistry'] | undefined> => {
  if (state.currentModelRegistry) return state.currentModelRegistry;

  const start = Date.now();
  let delay = REGISTRY_WAIT_INITIAL_DELAY_MS;
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (state.currentModelRegistry) return state.currentModelRegistry;
    delay = Math.min(delay * 2, REGISTRY_WAIT_MAX_DELAY_MS);
  }
  return undefined;
};

import {
  phaseForTier,
  buildRoutingDecision,
  decideRouting,
  runClassifier,
  extractTextFromContent,
  hasImageAttachment,
  getLastPromptText,
} from './routing';

export const createErrorMessage = (
  model: Model<Api>,
  message: string,
): AssistantMessage => {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now(),
  };
};

/**
 * Heuristic token estimator (conservative: 3 characters per token)
 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/**
 * Truncate context to fit within a target token limit by removing oldest messages.
 * Always preserves the first system message and the latest user message.
 */
const truncateContext = (context: Context, limit: number): Context => {
  const messages = [...context.messages];
  if (messages.length <= 1) return context;

  const systemTokens = context.systemPrompt ? estimateTokens(context.systemPrompt) : 0;

  // Pre-calculate token sizes
  const messageTokens = messages.map((m) =>
    estimateTokens(extractTextFromContent(m.content)),
  );
  const totalTokens = systemTokens + messageTokens.reduce((sum, t) => sum + t, 0);

  if (totalTokens <= limit) return context;

  const latestMessage = messages.pop();
  if (!latestMessage) return context;
  const latestTokens = messageTokens.pop() ?? 0;

  // Keep shifting oldest messages from the start of the list
  let activeMessagesTokensSum = messageTokens.reduce((sum, t) => sum + t, 0);

  let startIndex = 0;
  while (startIndex < messages.length) {
    const currentTokens = systemTokens + latestTokens + activeMessagesTokensSum;
    if (currentTokens <= limit) break;

    activeMessagesTokensSum -= messageTokens[startIndex];
    startIndex++;
  }

  const finalMessages = [...messages.slice(startIndex), latestMessage];
  return { ...context, messages: finalMessages };
};

export const registerRouterProvider = (
  pi: ExtensionAPI,
  state: {
    lastRegisteredModels: string;
    readonly currentConfig: RouterConfig;
    readonly currentModelRegistry:
      | ExtensionContext['modelRegistry']
      | undefined;
    readonly lastExtensionContext: ExtensionContext | undefined;
    selectedProfile: string | undefined;
    routerEnabled: boolean;
    lastDecision: RoutingDecision | undefined;
    accumulatedCost: number;
    /** Override for the registry wait timeout (for testing). */
    readonly registryTimeoutMs?: number;
  },
  actions: {
    persistState: () => void;
    recordDebugDecision: (decision: RoutingDecision) => void;
    updateStatus: (ctx: ExtensionContext) => void;
    syncPiThinkingLevel: (level: ThinkingLevel) => void;
  },
) => {
  const profileList = profileNames(state.currentConfig);

  // Map profiles to their capacities
  const modelDefinitions = profileList.map((name) => {
    const profile = state.currentConfig.profiles[name];

    // Report the MAX context window and max output tokens across all tiers.
    // The honesty check + truncateContext handles the case where the
    // actually routed model is smaller.
    let maxContextWindow = DEFAULT_CONTEXT_WINDOW;
    let maxMaxTokens = DEFAULT_MAX_TOKENS;
    for (const tier of ROUTER_TIERS) {
      if (!profile[tier]) continue;
      const cw = resolveContextWindow(
        tier,
        profile,
        state.currentModelRegistry,
      );
      const mot = resolveMaxTokens(
        tier,
        profile,
        state.currentModelRegistry,
      );
      if (cw > maxContextWindow) maxContextWindow = cw;
      if (mot > maxMaxTokens) maxMaxTokens = mot;
    }

    // Router models are fixed-thinking: never expose thinking levels.
    // Tier thinking comes from model-router.json; delegated reasoning is
    // clamped per-target model via resolveDelegatedReasoning.
    return {
      id: name,
      name: `Router ${name}`,
      reasoning: false,
      input: ['text', 'image'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: maxContextWindow,
      maxTokens: maxMaxTokens,
    };
  });

  const modelsKey = modelDefinitions
    .map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`)
    .join(',');
  if (state.lastRegisteredModels === modelsKey) return;

  pi.registerProvider('router', {
    baseUrl: 'router://local',
    apiKey: 'pi-model-router',
    api: 'router-local-api',
    models: modelDefinitions,
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const stream = createAssistantMessageEventStream();

      (async () => {
        try {
          // Wait for the router to be fully initialized (session_start sets currentModelRegistry).
          // This handles the race where subagents (e.g. from pi-dynamic-workflows) invoke
          // the router provider before session_start has fired in their context.
          const registry = await waitForRegistry(state, state.registryTimeoutMs);
          if (!registry) {
            throw new Error(
              'Router provider initialization timed out. session_start may not have fired.',
            );
          }
          const profile = state.currentConfig.profiles[model.id];
          if (!profile) {
            throw new Error(`Unknown router profile: ${model.id}`);
          }

          state.selectedProfile = model.id;
          state.routerEnabled = true;

          let decision: RoutingDecision = decideRouting(
            context,
            model.id,
            profile,
            state.lastDecision,
            state.currentConfig.rules,
          );

          // Priority: profile classifierModel > global classifierModel > profile low model
          const effectiveClassifier = resolveEffectiveClassifier(
            profile,
            state.currentConfig.classifierModel,
          );

          // --- Vector Cache Lookup (before LLM classifier) ---
          let queryEmbedding: number[] | undefined;
          let vectorHit = false;
          const vectorCache = state.currentConfig.vectorCache;
          const shouldUseVector = !!vectorCache?.enabled && !decision.isRuleMatched;

          if (shouldUseVector && vectorCache) {
            const promptForVector = getLastPromptText(context);
            // Skip vector cache if prompt exceeds embedding context window -> directly use LLM
            if (estimateTokens(promptForVector) > vectorCache.embeddingContextWindow) {
              // Exceeds embedding model context, bypass vector cache
            } else {
              const normalizedForVector = normalizePromptForEmbedding(promptForVector);
              if (normalizedForVector) {
              try {
                const store = getVectorStore(vectorCache.vectorFile, vectorCache.dimensions);
                if (store && store.isReady()) {
                  const emb = await embedText(promptForVector, vectorCache);
                  if (emb) {
                    queryEmbedding = emb;
                    const hit = store.search(emb, 1, vectorCache.threshold);
                    if (hit) {
                      decision = buildRoutingDecision(
                        model.id,
                        profile,
                        hit.tier,
                        phaseForTier(hit.tier),
                        `vector-cache hit similarity ${hit.similarity.toFixed(2)} (threshold ${vectorCache.threshold}) tier=${hit.tier} ${hit.reasoning ? `orig:${hit.reasoning}` : ''}`.trim(),
                        false,
                      );
                      decision.isVectorHit = true;
                      decision.vectorSimilarity = hit.similarity;
                      vectorHit = true;
                      try {
                        store.incrementHit(hit.normalized);
                      } catch (err) {
                        try { state.lastExtensionContext?.ui.notify(`Vector incrementHit failed: ${err instanceof Error ? err.message : String(err)}`, 'warning'); } catch {}
                      }

                      // Background refresh: continuously improve cache regardless of match
                      if (vectorCache.backgroundRefresh && effectiveClassifier) {
                        const bgPrompt = promptForVector;
                        const bgNormalized = normalizedForVector;
                        const bgEmbedding = emb;
                        const bgStore = store;
                        const bgClassifier = effectiveClassifier;
                        // Fire-and-forget
                        void (async () => {
                          try {
                            const classifierResult = await runClassifier(
                              bgClassifier.model,
                              registry,
                              context,
                              bgClassifier.thinking,
                            );
                            if (classifierResult) {
                              bgStore.upsert(bgPrompt, bgNormalized, classifierResult.tier, classifierResult.reasoning, bgEmbedding);
                            }
                          } catch (err) {
                            try { state.lastExtensionContext?.ui.notify(`Vector backgroundRefresh failed: ${err instanceof Error ? err.message : String(err)}`, 'warning'); } catch {}
                          }
                        })();
                      }
                    }
                  } else {
                    try { state.lastExtensionContext?.ui.notify(`Vector embed failed for: "${promptForVector.slice(0,40)}" — fallback to LLM`, 'warning'); } catch {}
                  }
                } else if (store?.error) {
                  try { state.lastExtensionContext?.ui.notify(`Vector store not ready: ${store.error}`, 'warning'); } catch {}
                } else {
                  if (!queryEmbedding) {
                    try { state.lastExtensionContext?.ui.notify(`Vector embed failed for: "${promptForVector.slice(0,40)}" — fallback to LLM`, 'warning'); } catch {}
                  }
                }
                } catch (err) {
                  try { state.lastExtensionContext?.ui.notify(`Vector cache lookup failed: ${err instanceof Error ? err.message : String(err)}`, 'warning'); } catch {}
                }
              }
            }
          }

          if (!vectorHit && effectiveClassifier && !decision.isRuleMatched) {
            const classifierResult = await runClassifier(
              effectiveClassifier.model,
              registry,
              context,
              effectiveClassifier.thinking,
            );
            if (classifierResult) {
              decision = buildRoutingDecision(
                model.id,
                profile,
                classifierResult.tier,
                phaseForTier(classifierResult.tier),
                `Classifier: ${classifierResult.reasoning}`,
                true,
              );
            }
          }

          // Persist current prompt to vector cache if not already a hit (learn from LLM or default)
          if (!vectorHit && vectorCache?.enabled) {
            const promptForVector = getLastPromptText(context);
            if (estimateTokens(promptForVector) > vectorCache.embeddingContextWindow) {
              // Too long for embedding model, skip caching
            } else {
              const normalizedForVector = normalizePromptForEmbedding(promptForVector);
              if (normalizedForVector) {
              try {
                const store = getVectorStore(vectorCache.vectorFile, vectorCache.dimensions);
                if (store && store.isReady()) {
                  let emb = queryEmbedding;
                  if (!emb) {
                    emb = await embedText(promptForVector, vectorCache) ?? undefined;
                  }
                  if (emb) {
                    store.upsert(promptForVector, normalizedForVector, decision.tier, decision.reasoning, emb);
                  }
                }
                } catch (err) {
                  try { state.lastExtensionContext?.ui.notify(`Vector cache persist failed: ${err instanceof Error ? err.message : String(err)}`, 'warning'); } catch {}
                }
              }
            }
          }

          const lastMessage = context.messages[context.messages.length - 1];
          const previousDecision = state.lastDecision;
          const isGoogleThinkingToolContinuation =
            lastMessage?.role === 'toolResult' &&
            previousDecision?.profile === model.id &&
            previousDecision.targetProvider === 'google' &&
            previousDecision.thinking !== 'off' &&
            decision.targetProvider === 'google' &&
            decision.thinking !== 'off' &&
            previousDecision.targetLabel !== decision.targetLabel;

          if (isGoogleThinkingToolContinuation && previousDecision) {
            decision = {
              ...decision,
              tier: previousDecision.tier,
              phase: previousDecision.phase,
              targetProvider: previousDecision.targetProvider,
              targetModelId: previousDecision.targetModelId,
              targetLabel: previousDecision.targetLabel,
              thinking: previousDecision.thinking,
              reasoning:
                `Preserved ${previousDecision.targetLabel} for a Google tool-result continuation ` +
                `to avoid thought-signature replay errors. (Original: ${decision.reasoning})`,
            };
          }

          const imageAttached = hasImageAttachment(context);
          const checkModelSupportsImage = (modelRef: string) => {
            try {
              const { provider, modelId } = parseCanonicalModelRef(modelRef);
              const m = registry.find(provider, modelId);
              return m?.input?.includes('image') ?? false;
            } catch {
              return false;
            }
          };

          if (imageAttached) {
            const tierModels = [
              decision.targetLabel,
              ...(profile[decision.tier]?.fallbacks ?? []),
            ];
            if (!tierModels.some(checkModelSupportsImage)) {
              const tiersToTry: RouterTier[] =
                decision.tier === 'low'
                  ? ['medium', 'high']
                  : decision.tier === 'medium'
                    ? ['high']
                    : [];

              let foundTier: RouterTier | undefined;
              for (const t of tiersToTry) {
                const tierConfig = profile[t];
                if (!tierConfig) continue;
                const tModels = [
                  tierConfig.model,
                  ...(tierConfig.fallbacks ?? []),
                ];
                if (tModels.some(checkModelSupportsImage)) {
                  foundTier = t;
                  break;
                }
              }

              if (foundTier) {
                const forced = buildRoutingDecision(
                  model.id,
                  profile,
                  foundTier,
                  phaseForTier(foundTier),
                  `Forced ${foundTier} tier because the originally routed ${decision.tier} tier does not support image attachments.`,
                  false,
                );
                // Preserve vector hit flag if applicable
                forced.isVectorHit = decision.isVectorHit;
                forced.vectorSimilarity = decision.vectorSimilarity;
                decision = forced;
              }
            }
          }

          state.lastDecision = decision;
          actions.recordDebugDecision(decision);

          // Sync pi's thinking level display with the router's effective thinking.
          // Wrapped in try/catch: in subagent contexts the extension runtime
          // may be invalidated (stale) after session teardown.
          try {
            actions.syncPiThinkingLevel(decision.thinking);
            if (state.lastExtensionContext) {
              actions.updateStatus(state.lastExtensionContext);
            }
          } catch {
            // Stale extension context — skip non-critical UI updates.
          }

          let modelsToTry = [...new Set([
            decision.targetLabel,
            ...(profile[decision.tier]?.fallbacks ?? []),
          ])];
          if (imageAttached) {
            modelsToTry = modelsToTry.filter(checkModelSupportsImage);
            if (modelsToTry.length === 0) {
              modelsToTry = [decision.targetLabel];
            }
          }
          let lastError: unknown;
          let success = false;

          for (let i = 0; i < modelsToTry.length; i++) {
            const modelRef = modelsToTry[i];
            const { provider: targetProvider, modelId: targetModelId } =
              parseCanonicalModelRef(modelRef);

            if (targetProvider === 'router') continue;

            const targetModel = registry.find(
              targetProvider,
              targetModelId,
            );
            if (!targetModel) {
              lastError = new Error(
                `Routed model not found: ${targetProvider}/${targetModelId}`,
              );
              continue;
            }

            const auth =
              await registry.getApiKeyAndHeaders(targetModel);
            if (!auth.ok || !auth.apiKey) {
              lastError = new Error(
                auth.ok
                  ? `No API key for routed model: ${targetProvider}/${targetModelId}`
                  : `Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`,
              );
              continue;
            }
            const apiKey = auth.apiKey;
            const headers = auth.headers;

            // getApiKeyAndHeaders() only resolves { apiKey, headers } — it does
            // not surface a credential-specific baseUrl. Some OAuth providers
            // (e.g. GitHub Copilot business/enterprise tenants) resolve a
            // per-token proxy endpoint that differs from the model's static
            // baseUrl. Without applying it here, delegated requests are sent
            // to the wrong host and fail with 421 Misdirected Request.
            const requestModel = await resolveDelegatedModel(
              registry as unknown as RegistryWithProviderAuth,
              targetModel,
            );

            try {
              // HONESTY CHECK & AUTO-TRUNCATION
              // If the picked model has a smaller context than what we reported, truncate now.
              let effectiveContext = context;
              const targetLimit = resolveContextWindow(
                decision.tier,
                profile,
                registry,
              );
              if (targetLimit < model.contextWindow!) {
                effectiveContext = truncateContext(context, targetLimit);
              }

              const delegatedReasoning = resolveDelegatedReasoning(
                targetModel,
                decision.thinking,
              ) as SimpleStreamOptions['reasoning'] | undefined;

              try {
                if (state.lastExtensionContext) {
                  if (delegatedReasoning) {
                    state.lastExtensionContext.ui.setHiddenThinkingLabel?.(
                      `Thinking (${targetProvider}/${targetModelId})...`,
                    );
                  } else {
                    state.lastExtensionContext.ui.setHiddenThinkingLabel?.();
                  }
                }
              } catch {
                // Stale extension context — skip non-critical UI updates.
              }

              // Strip pi's reasoning from options — the router controls thinking
              const { reasoning: _piReasoning, ...delegationOptions } =
                options ?? {};

              // Hook for local providers (e.g., pi-agent-bridge://) to handle without HTTP
              let delegatedStream: AssistantMessageEventStream | undefined;
              const localHandlers = getLocalHandlers();
              let handledLocally = false;
              for (const [prefix, handler] of localHandlers) {
                if (requestModel.baseUrl.startsWith(prefix)) {
                  delegatedStream = handler(
                    requestModel,
                    effectiveContext,
                    {
                      ...delegationOptions,
                      apiKey,
                      headers,
                      ...(delegatedReasoning
                        ? { reasoning: delegatedReasoning }
                        : {}),
                    },
                  );
                  handledLocally = true;
                  break;
                }
              }
              if (!handledLocally) {
                delegatedStream = streamSimple(
                  requestModel,
                  effectiveContext,
                  {
                    ...delegationOptions,
                    apiKey,
                    headers,
                    ...(delegatedReasoning
                      ? { reasoning: delegatedReasoning }
                      : {}),
                  },
                );
              }

              let contentReceived = false;
              if (!delegatedStream) throw new Error('No delegated stream available');
              for await (const event of delegatedStream) {
                if (event.type === 'done') {
                  const cost = event.message.usage?.cost?.total ?? 0;
                  state.accumulatedCost += cost;
                }
                if (event.type === 'error' && !contentReceived) {
                  const errorMessage =
                    'error' in event &&
                    event.error &&
                    typeof event.error === 'object' &&
                    'errorMessage' in event.error &&
                    typeof event.error.errorMessage === 'string'
                      ? event.error.errorMessage
                      : undefined;
                  throw new Error(
                    errorMessage || 'Model failed before sending content.',
                  );
                }
                const isContent =
                  event.type === 'text_delta' ||
                  event.type === 'thinking_delta' ||
                  event.type === 'toolcall_delta' ||
                  event.type === 'toolcall_end';
                if (isContent) contentReceived = true;
                stream.push(event);
              }
              success = true;
              if (i > 0) decision.isFallback = true;
              break;
            } catch (err) {
              lastError = err;
            }
          }

          if (!success) {
            throw (
              lastError instanceof Error
                ? lastError
                : new Error(
                    typeof lastError === 'string'
                      ? lastError
                      : 'Failed to delegate to any model in the chain.',
                  )
            );
          }

          stream.end();
        } catch (error) {
          // When a subagent session is torn down (e.g. by pi-dynamic-workflows),
          // the extension runtime is invalidated and any pi/ctx call throws a
          // stale-context error. Push a graceful done event so the stream's
          // result() promise resolves (required by AssistantMessageEventStream).
          const isStaleCtx =
            error instanceof Error && error.message.includes('stale');
          if (isStaleCtx) {
            stream.push({
              type: 'done',
              reason: 'stop',
              message: createErrorMessage(model, ''),
            });
          } else {
            stream.push({
              type: 'error',
              reason: 'error',
              error: createErrorMessage(
                model,
                error instanceof Error ? error.message : String(error),
              ),
            });
          }
          stream.end();
        } finally {
          try {
            actions.persistState();
          } catch {
            // Ignore: extension context may be stale after session teardown.
          }
        }
      })();

      return stream;
    },
  });

  state.lastRegisteredModels = modelsKey;
};
