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
import {
  buildRoutingDecision,
  decideRouting,
} from './routing';
import { runClassifier } from './classifier';
import {
  hasImageAttachment,
  getLastUserText,
  estimateTokens,
  truncateContext,
} from './context';
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
  for (let delay = REGISTRY_WAIT_INITIAL_DELAY_MS; Date.now() - start < timeoutMs; delay = Math.min(delay * 2, REGISTRY_WAIT_MAX_DELAY_MS)) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (state.currentModelRegistry) return state.currentModelRegistry;
  }
  return undefined;
};

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
  // Serialize commits to shared mutable state (lastDecision, accumulatedCost,
  // selectedProfile, routerEnabled) so concurrent router requests do not
  // interleave partial writes. Read path uses per-request snapshots.
  let commitMutex: Promise<void> = Promise.resolve();
  const withCommitMutex = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const prev = commitMutex;
    let release!: () => void;
    commitMutex = new Promise<void>((r) => { release = r; });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };
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

          // Per-request isolation: snapshot shared state and work with locals.
          // All reads of lastDecision use the snapshot to avoid races with
          // concurrent requests. Shared writes are committed via mutex.
          const snapshotLastDecision = state.lastDecision;
          const effectiveSignal: AbortSignal | undefined = (() => {
            const s = options?.signal;
            const timeoutFn = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
            const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
            if (s) {
              const t = timeoutFn?.(30000);
              if (t && anyFn) return anyFn([s, t]);
              return s;
            }
            return timeoutFn?.(30000);
          })();

          await withCommitMutex(async () => {
            state.selectedProfile = model.id;
            state.routerEnabled = true;
          });

          let decision: RoutingDecision = decideRouting(
            context,
            model.id,
            profile,
            snapshotLastDecision,
          );

          const lastMessageForLoop = context.messages[context.messages.length - 1];
          const isGoogleThinkingLoop = snapshotLastDecision?.targetProvider === 'google' && snapshotLastDecision?.thinking !== 'off';
          const isToolLoop = lastMessageForLoop?.role === 'toolResult' && snapshotLastDecision?.profile === model.id && snapshotLastDecision !== undefined && !isGoogleThinkingLoop;
          const shouldSkipClassifier = isToolLoop || isGoogleThinkingLoop;
          if (isToolLoop && snapshotLastDecision) {
            decision = buildRoutingDecision(
              model.id,
              profile,
              snapshotLastDecision.tier,
              `Preserved ${snapshotLastDecision.tier} tier during toolResult loop`,
              false,
            );
          }

          const effectiveClassifier = resolveEffectiveClassifier(
            profile,
            state.currentConfig.classifierModel,
          );

          if (!shouldSkipClassifier && effectiveClassifier) {
            if (effectiveSignal?.aborted) {
              throw new Error('aborted');
            }
            const effectiveHistorySize = state.currentConfig.historySize ?? 0;
            const classifierResult = await runClassifier(
              effectiveClassifier.model,
              registry,
              context,
              effectiveHistorySize,
              effectiveClassifier.thinking,
              effectiveSignal,
            );
            if (effectiveSignal?.aborted) throw new Error('aborted');
            if (classifierResult) {
              decision = buildRoutingDecision(
                model.id,
                profile,
                classifierResult.tier,
                `Classifier: ${classifierResult.reasoning}`,
                true,
              );
            }
          }

          const lastMessage = context.messages[context.messages.length - 1];
          const previousDecision = snapshotLastDecision;
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
                  `Forced ${foundTier} tier because the originally routed ${decision.tier} tier does not support image attachments.`,
                  false,
                );
                decision = forced;
              }
            }
          }

          await withCommitMutex(async () => {
            state.lastDecision = decision;
          });
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
              throw new Error('No image-capable model available for this profile. Attachments would be silently dropped as placeholder text.');
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

            if (effectiveSignal?.aborted) {
              throw new Error('aborted');
            }
            let contentReceivedForTry = false;
            let pendingCostDelta = 0;
            try {
              // HONESTY CHECK & AUTO-TRUNCATION
              // If the picked model has a smaller context than what we reported, truncate now.
              // Resolve limit per attempted model, not the original tier, so a small fallback does not overflow.
              // Note: estimateTokens uses chars/3 which underestimates CJK (≈1-1.5 tok/char); truncation may still be insufficient for heavy CJK histories.
              let effectiveContext = context;
              let targetLimit: number;
              {
                let tierForModel: RouterTier | undefined;
                for (const t of ROUTER_TIERS) {
                  const tc = profile[t];
                  if (!tc) continue;
                  if (tc.model === modelRef || tc.fallbacks?.includes(modelRef)) {
                    tierForModel = t;
                    break;
                  }
                }
                if (tierForModel) {
                  targetLimit = resolveContextWindow(tierForModel, profile, registry);
                } else {
                  const found = registry.find(targetProvider, targetModelId);
                  targetLimit = found?.contextWindow ?? resolveContextWindow(decision.tier, profile, registry);
                }
              }
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
              // Keep effectiveSignal as the signal for delegated calls
              const { reasoning: _piReasoning, signal: _piSignal, ...delegationOptionsBase } =
                (options ?? {}) as SimpleStreamOptions & { signal?: AbortSignal };
              const delegationOptions = {
                ...delegationOptionsBase,
                ...(effectiveSignal ? { signal: effectiveSignal } : {}),
              };

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

              // Buffer events until success to avoid pushing primary start/content before fallback succeeds (would duplicate partial assistant messages in core).
              const bufferedEvents: unknown[] = [];
              let gotDone = false;
              let gotError = false;
              let bufferedErrorMessage: string | undefined;
              if (!delegatedStream) throw new Error('No delegated stream available');
              for await (const event of delegatedStream) {
                if (effectiveSignal?.aborted) {
                  throw new Error('aborted');
                }
                bufferedEvents.push(event);
                if ((event as { type: string }).type === 'done') {
                  gotDone = true;
                  const cost = (event as { message?: { usage?: { cost?: { total?: number } } } }).message?.usage?.cost?.total ?? 0;
                  pendingCostDelta = cost;
                }
                if ((event as { type: string }).type === 'error') {
                  gotError = true;
                  const errObj = (event as { error?: unknown }).error;
                  if (errObj && typeof errObj === 'object' && 'errorMessage' in errObj && typeof (errObj as { errorMessage?: unknown }).errorMessage === 'string') {
                    bufferedErrorMessage = (errObj as { errorMessage: string }).errorMessage;
                  }
                }
                const isContent =
                  (event as { type: string }).type === 'text_delta' ||
                  (event as { type: string }).type === 'thinking_delta' ||
                  (event as { type: string }).type === 'toolcall_delta' ||
                  (event as { type: string }).type === 'toolcall_end';
                if (isContent) contentReceivedForTry = true;
              }
              if (gotDone) {
                for (const ev of bufferedEvents) stream.push(ev as never);
                success = true;
                if (pendingCostDelta) {
                  await withCommitMutex(async () => {
                    state.accumulatedCost += pendingCostDelta;
                  });
                }
                if (i > 0) {
                  const { provider: fp, modelId: fid } = parseCanonicalModelRef(modelRef);
                  decision.isFallback = true;
                  decision.targetProvider = fp;
                  decision.targetModelId = fid;
                  decision.targetLabel = modelRef;
                  await withCommitMutex(async () => {
                    // Keep state.lastDecision in sync with fallback target
                    if (state.lastDecision === decision || state.lastDecision?.profile === decision.profile) {
                      state.lastDecision = { ...decision };
                    }
                  });
                  actions.recordDebugDecision(decision);
                }
                break;
              }
              if (gotError) {
                if (contentReceivedForTry) {
                  // Content already buffered from this attempt; do not try fallback to avoid duplicate partial output.
                  for (const ev of bufferedEvents) stream.push(ev as never);
                  throw new Error(`NON_RETRYABLE: ${bufferedErrorMessage || 'Model failed after sending content.'}`);
                }
                throw new Error(bufferedErrorMessage || 'Model failed before sending content.');
              }
              // Stream ended without terminal event -> treat as failure so fallback can be tried (if no content) or error surfaces.
              throw new Error('Model stream ended without terminal event.');
            } catch (err) {
              if (err instanceof Error && (err.message.startsWith('NON_RETRYABLE:') || err.message === 'aborted')) {
                lastError = err instanceof Error && err.message.startsWith('NON_RETRYABLE:') ? new Error(err.message.slice('NON_RETRYABLE: '.length)) : err;
                break;
              }
              // If content was sent before the thrown error, do not retry fallback to avoid duplicate output.
              if (typeof contentReceivedForTry !== 'undefined' && contentReceivedForTry) {
                lastError = err;
                break;
              }
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
          const isAborted = error instanceof Error && error.message === 'aborted';
          if (isAborted) {
            // User cancelled - graceful termination, no fallback, no error
            stream.push({
              type: 'done',
              reason: 'stop',
              message: createErrorMessage(model, 'aborted'),
            });
            stream.end();
            return;
          }
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
