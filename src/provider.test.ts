import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerRouterProvider, createErrorMessage, waitForRegistry } from './provider';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { Api, Context, Model, AssistantMessageEventStream, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { RouterConfig, RouterTier } from './types';
import { getVectorStore } from './vector-store';
import { embedText } from './embeddings';
import { runClassifier } from './routing';

interface MockEvent {
  type: string;
  delta?: string;
  error?: { errorMessage?: string };
  message?: { usage?: { cost?: { total: number } } };
}

class MockEventStream {
  events: MockEvent[] = [];

  push(event: MockEvent) {
    this.events.push(event);
  }

  end() {}
}

vi.mock('@earendil-works/pi-ai', () => ({
  createAssistantMessageEventStream: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  streamSimple: vi.fn(),
}));

vi.mock('./vector-store', () => ({
  getVectorStore: vi.fn(),
  closeVectorStore: vi.fn(),
  getExistingVectorStore: vi.fn(),
  VectorStore: vi.fn(),
}));

vi.mock('./embeddings', () => ({
  embedText: vi.fn(),
  embedTexts: vi.fn(),
  normalizePromptForEmbedding: vi.fn((text: string) => text.trim().toLowerCase().slice(0, 8000)),
}));

vi.mock('./routing', async () => {
  const actual = await vi.importActual<typeof import('./routing')>('./routing');
  return {
    ...actual,
    runClassifier: vi.fn(),
  };
});

type ProviderState = Parameters<typeof registerRouterProvider>[1];
type ProviderActions = Parameters<typeof registerRouterProvider>[2];
type MutableProviderState = { -readonly [K in keyof ProviderState]: ProviderState[K] };

interface RegisteredProviderOptions {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: {
    id: string;
    name: string;
    reasoning: boolean;
    input: readonly ('text' | 'image')[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
    thinkingLevelMap?: Record<string, string>;
  }[];
  streamSimple: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
}

describe('provider.ts', () => {
  let mockPi: ExtensionAPI;
  let mockState: MutableProviderState;
  let mockActions: ProviderActions;
  let registeredProviderName: string | null = null;
  let registeredProviderOptions: RegisteredProviderOptions | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredProviderName = null;
    registeredProviderOptions = null;

    mockPi = {
      registerProvider: (name: string, options: Parameters<ExtensionAPI['registerProvider']>[1]) => {
        registeredProviderName = name;
        registeredProviderOptions = options as unknown as RegisteredProviderOptions;
      },
    } as unknown as ExtensionAPI;

    const config: RouterConfig = {
      profiles: {
        balanced: {
          high: { model: 'openai/gpt-4o', resolvedContextWindow: 10000 },
          medium: {
            model: 'openai/gpt-4o-mini',
            resolvedContextWindow: 5000,
            fallbacks: ['google/gemini-1.5-flash'],
          },
        },
      },
    };

    const mockRegistry = {
      find: (provider: string, modelId: string) => {
        if (provider === 'openai' || provider === 'google') {
          return { provider, id: modelId, input: ['text', 'image'] as const } as unknown as Model<Api>;
        }
        return undefined;
      },
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: 'test-key',
        headers: {},
      }),
    } as unknown as ExtensionContext['modelRegistry'];

    mockState = {
      lastRegisteredModels: '',
      currentConfig: config,
      currentModelRegistry: mockRegistry,
      lastExtensionContext: {
        ui: {
          setHiddenThinkingLabel: vi.fn(),
        },
      } as unknown as ExtensionContext,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
    };

    mockActions = {
      persistState: vi.fn(),
      recordDebugDecision: vi.fn(),
      updateStatus: vi.fn(),
      syncPiThinkingLevel: vi.fn(),
    };
  });

  describe('createErrorMessage', () => {
    it('should create a valid error AssistantMessage', () => {
      const model = { api: 'openai' as Api, provider: 'openai', id: 'gpt-4o' } as unknown as Model<Api>;
      const msg = createErrorMessage(model, 'Test error message');
      expect(msg.role).toBe('assistant');
      expect(msg.errorMessage).toBe('Test error message');
      expect(msg.stopReason).toBe('error');
    });
  });

  describe('registerRouterProvider', () => {
    it('should register provider under router name', () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      expect(registeredProviderName).toBe('router');
      expect(registeredProviderOptions).toBeDefined();
      expect(registeredProviderOptions!.models[0].id).toBe('balanced');
    });

    it('should delegate streams and accumulate cost on success', async () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      const delegateStream = (async function* () {
        yield { type: 'text_delta', delta: 'Answer part' };
        yield { type: 'done', message: { usage: { cost: { total: 0.0015 } } } };
      })();
      vi.mocked(streamSimple).mockReturnValue(delegateStream as unknown as ReturnType<typeof streamSimple>);

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      const providerStream = registeredProviderOptions!.streamSimple(
        model,
        context,
      );

      // Wait for async execution of stream handler
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockState.selectedProfile).toBe('balanced');
      expect(mockState.routerEnabled).toBe(true);
      expect(mockState.accumulatedCost).toBe(0.0015);
      expect(mockActions.persistState).toHaveBeenCalled();
    });

    it('should try fallbacks if the primary model fails', async () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      let callCount = 0;
      vi.mocked(streamSimple).mockImplementation(((model: Model<Api>) => {
        callCount++;
        if (model.id === 'gpt-4o-mini') {
          // Force fail for primary
          return (async function* () {
            throw new Error('primary failed');
          })() as unknown as ReturnType<typeof streamSimple>;
        }
        // Success for fallback
        return (async function* () {
          yield { type: 'text_delta', delta: 'fallback answer' };
          yield {
            type: 'done',
            message: { usage: { cost: { total: 0.0005 } } },
          };
        })() as unknown as ReturnType<typeof streamSimple>;
      }));

      // Force a medium tier routing decision

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(callCount).toBe(2);
      expect(mockState.accumulatedCost).toBe(0.0005);
      expect(mockState.lastDecision!.isFallback).toBe(true);
    });

    it('should preserve previous Google model on Google thinking tool continuation', async () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );
      vi.mocked(streamSimple).mockReturnValue(
        (async function* () {
          yield { type: 'text_delta', delta: 'done' };
        })() as unknown as ReturnType<typeof streamSimple>,
      );

      // Set up last decision as Google model with thinking
      mockState.lastDecision = {
        profile: 'balanced',
        tier: 'high',
        phase: 'planning',
        targetProvider: 'google',
        targetModelId: 'gemini-2.5-pro',
        targetLabel: 'google/gemini-2.5-pro',
        thinking: 'high',
        reasoning: 'initial google model reasoning',
        timestamp: Date.now(),
      };

      // Configure profile tiers to use google provider models
      mockState.currentConfig.profiles.balanced.high = {
        model: 'google/gemini-2.5-pro',
        thinking: 'high' as ThinkingLevel,
      };
      mockState.currentConfig.profiles.balanced.medium = {
        model: 'google/gemini-2.5-flash',
        thinking: 'medium' as ThinkingLevel,
      };

      // Set up registry search
      mockState.currentModelRegistry!.find = (
        provider: string,
        modelId: string,
      ) => {
        return { provider, id: modelId, reasoning: true, input: ['text'] as const } as unknown as Model<Api>;
      };

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = {
        messages: [
          { role: 'user', content: 'initial', timestamp: Date.now() },
          {
            role: 'toolResult',
            toolCallId: 'c1',
            toolName: 't',
            content: 'tool output',
            isError: false,
            timestamp: Date.now(),
          },
        ],
      } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // The decision should be updated to preserve the previous model
      expect(mockState.lastDecision!.targetModelId).toBe('gemini-2.5-pro');
      expect(mockState.lastDecision!.reasoning).toContain(
        'Preserved google/gemini-2.5-pro for a Google tool-result continuation',
      );
    });

    it('should force higher tier if current tier does not support image attachments', async () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );
      vi.mocked(streamSimple).mockReturnValue(
        (async function* () {
          yield { type: 'text_delta', delta: 'done' };
        })() as unknown as ReturnType<typeof streamSimple>,
      );

      // Define medium tier model and fallback without image support, high tier model with image support
      mockState.currentModelRegistry!.find = (
        provider: string,
        modelId: string,
      ) => {
        if (modelId === 'gpt-4o') {
          return { provider, id: modelId, input: ['text', 'image'] as const } as unknown as Model<Api>; // high does support image
        }
        return { provider, id: modelId, input: ['text'] as const } as unknown as Model<Api>; // medium and fallback gemini-1.5-flash don't support image
      };

      // Force a medium tier routing decision originally

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image' as const,
                image: { mimeType: 'image/png', data: 'data' },
              },
            ],
            timestamp: Date.now(),
          },
        ],
      } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // It should force switch to high tier because medium doesn't support images
      expect(mockState.lastDecision!.tier).toBe('high');
      expect(mockState.lastDecision!.reasoning).toContain(
        'Forced high tier because the originally routed medium tier does not support image attachments',
      );
    });

    it('should auto-truncate context if target limit is smaller than reported context window', async () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      let truncatedContextPassed: Context | null = null;
      vi.mocked(streamSimple).mockImplementation(((model: Model<Api>, ctx: Context) => {
        truncatedContextPassed = ctx;
        return (async function* () {
          yield { type: 'text_delta', delta: 'done' };
        })() as unknown as ReturnType<typeof streamSimple>;
      }));

      // Medium tier model has resolvedContextWindow = 5000 in config.
      // But let's verify if reported max context window of router is larger (which is 10000 from high tier).

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
        contextWindow: 10000,
      } as unknown as Model<Api>;

      // Let's create a large context that exceeds 5000 tokens (approx 15000 chars)
      const context = {
        systemPrompt: 'System prompt instructions',
        messages: [
          { role: 'user', content: 'a'.repeat(8000), timestamp: Date.now() },
          { role: 'user', content: 'b'.repeat(8000), timestamp: Date.now() },
          { role: 'user', content: 'c'.repeat(2000), timestamp: Date.now() }, // latest message
        ],
      } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(truncatedContextPassed).toBeDefined();
      // Old messages should have been truncated to fit 5000 tokens limit (15000 chars approx)
      // The first message 'a'.repeat(8000) should have been shifted out.
      expect(truncatedContextPassed!.messages.length).toBeLessThan(
        context.messages.length,
      );
      expect(
        truncatedContextPassed!.messages[
          truncatedContextPassed!.messages.length - 1
        ].content,
      ).toBe('c'.repeat(2000));
    });

    it('should push error event when currentModelRegistry never becomes available', async () => {
      mockState.currentModelRegistry = undefined;
      mockState.registryTimeoutMs = 100; // Use short timeout for test
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await vi.waitFor(
        () => {
          const errorEvent = stream.events.find((e) => e.type === 'error');
          expect(errorEvent).toBeDefined();
          expect(errorEvent?.error?.errorMessage).toContain('timed out');
        },
        { timeout: 500 },
      );
      expect(mockActions.persistState).toHaveBeenCalled();
    });

    it('should wait and succeed when currentModelRegistry becomes available after a delay', async () => {
      mockState.currentModelRegistry = undefined;
      mockState.registryTimeoutMs = 500; // Allow enough time but not too long
      const mockRegistry = {
        find: (provider: string, modelId: string) => {
          if (provider === 'openai' || provider === 'google') {
            return { provider, id: modelId, input: ['text', 'image'] as const } as unknown as Model<Api>;
          }
          return undefined;
        },
        getApiKeyAndHeaders: async () => ({
          ok: true,
          apiKey: 'test-key',
          headers: {},
        }),
      } as unknown as ExtensionContext['modelRegistry'];

      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      const delegateStream = (async function* () {
        yield { type: 'text_delta', delta: 'Answer' };
        yield { type: 'done', message: { usage: { cost: { total: 0.001 } } } };
      })();
      vi.mocked(streamSimple).mockReturnValue(delegateStream as unknown as ReturnType<typeof streamSimple>);

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      // Simulate session_start setting the registry after 10ms
      setTimeout(() => {
        mockState.currentModelRegistry = mockRegistry;
      }, 10);

      await vi.waitFor(
        () => {
          expect(mockState.routerEnabled).toBe(true);
          expect(mockState.selectedProfile).toBe('balanced');
        },
        { timeout: 1000 },
      );
    });

    it('should push error event when profile is unknown', async () => {
      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      const model = {
        id: 'nonexistent-profile',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorEvent = stream.events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error?.errorMessage).toContain('Unknown router profile');
      expect(mockActions.persistState).toHaveBeenCalled();
    });

    it('should fall back when auth fails for primary model', async () => {
      let authCallCount = 0;
      mockState.currentModelRegistry!.getApiKeyAndHeaders = async (model: Model<Api>) => {
        authCallCount++;
        if (model.id === 'gpt-4o-mini') {
          return { ok: false, error: 'auth-error' };
        }
        return { ok: true, apiKey: 'fallback-key', headers: {} };
      };

      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      vi.mocked(streamSimple).mockReturnValue(
        (async function* () {
          yield { type: 'text_delta', delta: 'fallback answer' };
          yield { type: 'done', message: { usage: { cost: { total: 0.001 } } } };
        })() as unknown as ReturnType<typeof streamSimple>,
      );

      // Pin to medium so primary is gpt-4o-mini with fallback gemini-1.5-flash

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(authCallCount).toBeGreaterThanOrEqual(2);
      expect(mockState.accumulatedCost).toBe(0.001);
    });

    it('should skip model not found in registry and try fallback', async () => {
      mockState.currentModelRegistry!.find = (provider: string, modelId: string) => {
        if (modelId === 'gpt-4o-mini') return undefined; // primary not found
        return { provider, id: modelId, input: ['text', 'image'] as const } as unknown as Model<Api>;
      };

      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      vi.mocked(streamSimple).mockReturnValue(
        (async function* () {
          yield { type: 'text_delta', delta: 'answer from fallback' };
          yield { type: 'done', message: { usage: { cost: { total: 0.002 } } } };
        })() as unknown as ReturnType<typeof streamSimple>,
      );

      // Pin to medium so primary is gpt-4o-mini with fallback gemini-1.5-flash

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockState.accumulatedCost).toBe(0.002);
      expect(mockState.lastDecision!.isFallback).toBe(true);
    });

    it('should push error when all models in chain fail', async () => {
      vi.mocked(streamSimple).mockImplementation((() => {
        return (async function* () {
          throw new Error('model unavailable');
        })() as unknown as ReturnType<typeof streamSimple>;
      }));

      registerRouterProvider(mockPi, mockState, mockActions);
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(
        stream as unknown as AssistantMessageEventStream,
      );

      // Pin to medium to get fallback chain

      const model = {
        id: 'balanced',
        api: 'router-api' as Api,
        provider: 'router',
      } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorEvent = stream.events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error?.errorMessage).toContain('model unavailable');
      expect(mockActions.persistState).toHaveBeenCalled();
    });
  });

  describe('waitForRegistry', () => {
    it('should return registry immediately if already available', async () => {
      const mockRegistry = { find: vi.fn() } as unknown as ExtensionContext['modelRegistry'];
      const state = { currentModelRegistry: mockRegistry };
      const result = await waitForRegistry(state, 1000);
      expect(result).toBe(mockRegistry);
    });

    it('should wait and return registry when it becomes available', async () => {
      const mockRegistry = { find: vi.fn() } as unknown as ExtensionContext['modelRegistry'];
      const state: { currentModelRegistry: ExtensionContext['modelRegistry'] | undefined } = {
        currentModelRegistry: undefined,
      };

      // Set registry after 100ms
      setTimeout(() => {
        state.currentModelRegistry = mockRegistry;
      }, 100);

      const result = await waitForRegistry(state, 2000);
      expect(result).toBe(mockRegistry);
    });

    it('should return undefined after timeout if registry never becomes available', async () => {
      const state = { currentModelRegistry: undefined };
      const result = await waitForRegistry(state, 200);
      expect(result).toBeUndefined();
    });
  });

  describe('vector cache integration', () => {
    const makeVectorCache = (overrides: Record<string, unknown> = {}) => ({
      enabled: true,
      threshold: 0.88,
      vectorFile: 'test.db',
      embeddingModel: 'qwen3-embedding:0.6b',
      embeddingBaseUrl: 'http://localhost:11434',
      backgroundRefresh: false,
      dimensions: 3,
      embeddingContextWindow: 8192,
      ...overrides,
    });

    const setupDelegateSuccess = () => {
      vi.mocked(streamSimple).mockReturnValue(
        (async function* () {
          yield { type: 'text_delta', delta: 'done' };
          yield { type: 'done', message: { usage: { cost: { total: 0 } } } };
        })() as unknown as ReturnType<typeof streamSimple>,
      );
    };

    it('should use vector tier on hit, set isVectorHit true, incrementHit, and trigger background classifier when backgroundRefresh true', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache({ backgroundRefresh: true }) as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const hit = {
        tier: 'high' as RouterTier,
        similarity: 0.95,
        normalized: 'hello',
        reasoning: 'orig reason',
        distance: 0.05,
        prompt: 'hello',
        hitCount: 2,
        updatedAt: Date.now(),
      };
      const mockStore = {
        isReady: vi.fn(() => true),
        search: vi.fn(() => hit),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: undefined,
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'bg classifier' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));
      // allow background fire-and-forget to complete
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(mockState.lastDecision!.tier).toBe('high');
      expect(mockState.lastDecision!.isVectorHit).toBe(true);
      expect(mockState.lastDecision!.vectorSimilarity).toBeCloseTo(0.95);
      expect(mockStore.incrementHit).toHaveBeenCalledWith('hello');
      expect(vi.mocked(embedText)).toHaveBeenCalled();
      expect(mockStore.search).toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).toHaveBeenCalled();
      expect(mockStore.upsert).toHaveBeenCalled();
    });

    it('should fallback to classifier and upsert on vector miss', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache({ backgroundRefresh: false }) as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockStore = {
        isReady: vi.fn(() => true),
        search: vi.fn(() => undefined),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: undefined,
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'classifier low' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(mockStore.search).toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).toHaveBeenCalled();
      expect(mockStore.upsert).toHaveBeenCalled();
      expect(mockState.lastDecision!.tier).toBe('low');
      expect(mockState.lastDecision!.isVectorHit).not.toBe(true);
      expect(mockStore.incrementHit).not.toHaveBeenCalled();
    });

    it('should bypass vector cache when prompt exceeds embeddingContextWindow', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache({ embeddingContextWindow: 5 }) as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockStore = {
        isReady: vi.fn(() => true),
        search: vi.fn(() => ({ tier: 'high' as RouterTier, similarity: 0.99, normalized: 'a', reasoning: '', distance: 0.01, prompt: 'a', hitCount: 1, updatedAt: Date.now() })),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: undefined,
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'classifier bypass' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      // prompt length 20 => tokens ceil(20/3)=7 > 5, so bypass
      const longPrompt = 'a'.repeat(20);
      const context = { messages: [{ role: 'user', content: longPrompt }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(vi.mocked(embedText)).not.toHaveBeenCalled();
      expect(mockStore.search).not.toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).toHaveBeenCalled();
    });

    it('should fallback to classifier when store is not ready', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache() as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockStore = {
        isReady: vi.fn(() => false),
        search: vi.fn(),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: 'init failed',
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'classifier fallback' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(vi.mocked(getVectorStore)).toHaveBeenCalled();
      expect(mockStore.search).not.toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).toHaveBeenCalled();
      expect(mockState.lastDecision!.tier).toBe('low');
    });

    it('should fallback to classifier when embedText returns undefined', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache() as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockStore = {
        isReady: vi.fn(() => true),
        search: vi.fn(),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: undefined,
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue(undefined);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'classifier fallback' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(vi.mocked(embedText)).toHaveBeenCalled();
      expect(mockStore.search).not.toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).toHaveBeenCalled();
      expect(mockState.lastDecision!.tier).toBe('low');
    });

    it('should not trigger background classifier when backgroundRefresh is false on hit', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache({ backgroundRefresh: false }) as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const hit = {
        tier: 'high' as RouterTier,
        similarity: 0.92,
        normalized: 'hello',
        reasoning: 'orig',
        distance: 0.08,
        prompt: 'hello',
        hitCount: 1,
        updatedAt: Date.now(),
      };
      const mockStore = {
        isReady: vi.fn(() => true),
        search: vi.fn(() => hit),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: undefined,
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'should not be called' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(mockState.lastDecision!.tier).toBe('high');
      expect(mockState.lastDecision!.isVectorHit).toBe(true);
      expect(mockStore.incrementHit).toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).not.toHaveBeenCalled();
    });

    it('should upsert on miss when vector cache is enabled', async () => {
      mockState.currentConfig.vectorCache = makeVectorCache({ backgroundRefresh: false }) as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };

      const mockEmbedding = [0.4, 0.5, 0.6];
      const mockStore = {
        isReady: vi.fn(() => true),
        search: vi.fn(() => undefined),
        incrementHit: vi.fn(),
        upsert: vi.fn(() => true),
        error: undefined,
      };

      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'classifier reason' });

      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();

      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'test query for upsert' }] } as unknown as Context;

      registeredProviderOptions!.streamSimple(model, context);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(mockStore.search).toHaveBeenCalled();
      expect(vi.mocked(runClassifier)).toHaveBeenCalled();
      expect(mockStore.upsert).toHaveBeenCalled();
      const upsertArgs = mockStore.upsert.mock.calls[0] as unknown[];
      expect(upsertArgs[2]).toBe('low');
      expect(mockState.lastDecision!.tier).toBe('low');
    });
  });

  describe('vector cache error logging via TUI notify', () => {
    const makeVectorCache = (overrides: Record<string, unknown> = {}) => ({
      enabled: true,
      threshold: 0.88,
      vectorFile: 'test.db',
      embeddingModel: 'qwen3-embedding:0.6b',
      embeddingBaseUrl: 'http://localhost:11434',
      backgroundRefresh: false,
      dimensions: 3,
      embeddingContextWindow: 8192,
      ...overrides,
    });
    const setupDelegateSuccess = () => {
      vi.mocked(streamSimple).mockReturnValue(
        (async function* () {
          yield { type: 'text_delta', delta: 'done' };
          yield { type: 'done', message: { usage: { cost: { total: 0 } } } };
        })() as unknown as ReturnType<typeof streamSimple>,
      );
    };
    const makeNotifyContext = () => ({
      ui: { setHiddenThinkingLabel: vi.fn(), notify: vi.fn() },
    }) as unknown as ExtensionContext;

    it('should notify when store is not ready', async () => {
      const notifyCtx = makeNotifyContext();
      mockState.lastExtensionContext = notifyCtx;
      mockState.currentConfig.vectorCache = makeVectorCache() as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };
      const mockStore = { isReady: vi.fn(() => false), search: vi.fn(), incrementHit: vi.fn(), upsert: vi.fn(() => true), error: 'init failed' };
      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'r' });
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();
      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;
      registeredProviderOptions!.streamSimple(model, context);
      await new Promise((r) => setTimeout(r, 120));
      expect(notifyCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Vector store not ready'), 'warning');
    });

    it('should notify when embed fails', async () => {
      const notifyCtx = makeNotifyContext();
      mockState.lastExtensionContext = notifyCtx;
      mockState.currentConfig.vectorCache = makeVectorCache() as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };
      const mockStore = { isReady: vi.fn(() => true), search: vi.fn(() => undefined), incrementHit: vi.fn(), upsert: vi.fn(() => true), error: undefined };
      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue(undefined);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'r' });
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();
      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;
      registeredProviderOptions!.streamSimple(model, context);
      await new Promise((r) => setTimeout(r, 120));
      expect(notifyCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Vector embed failed'), 'warning');
    });

    it('should notify when vector lookup throws', async () => {
      const notifyCtx = makeNotifyContext();
      mockState.lastExtensionContext = notifyCtx;
      mockState.currentConfig.vectorCache = makeVectorCache() as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };
      const mockStore = { isReady: vi.fn(() => true), search: vi.fn(() => { throw new Error('search boom'); }), incrementHit: vi.fn(), upsert: vi.fn(() => true), error: undefined };
      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'r' });
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();
      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;
      registeredProviderOptions!.streamSimple(model, context);
      await new Promise((r) => setTimeout(r, 120));
      expect(notifyCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Vector cache lookup failed'), 'warning');
    });

    it('should notify when incrementHit throws', async () => {
      const notifyCtx = makeNotifyContext();
      mockState.lastExtensionContext = notifyCtx;
      mockState.currentConfig.vectorCache = makeVectorCache() as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };
      const hit = { tier: 'high' as RouterTier, similarity: 0.9, normalized: 'hello', reasoning: 'r', distance: 0.1, prompt: 'hello', hitCount: 1, updatedAt: Date.now() };
      const mockStore = { isReady: vi.fn(() => true), search: vi.fn(() => hit), incrementHit: vi.fn(() => { throw new Error('incr fail'); }), upsert: vi.fn(() => true), error: undefined };
      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'r' });
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();
      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;
      registeredProviderOptions!.streamSimple(model, context);
      await new Promise((r) => setTimeout(r, 120));
      expect(notifyCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('incrementHit failed'), 'warning');
    });

    it('should notify when backgroundRefresh upsert throws', async () => {
      const notifyCtx = makeNotifyContext();
      mockState.lastExtensionContext = notifyCtx;
      mockState.currentConfig.vectorCache = makeVectorCache({ backgroundRefresh: true }) as unknown as RouterConfig['vectorCache'];
      mockState.currentConfig.classifierModel = { model: 'openai/gpt-4o' };
      mockState.currentConfig.profiles.balanced.low = { model: 'openai/gpt-4o-nano', resolvedContextWindow: 5000 };
      const hit = { tier: 'high' as RouterTier, similarity: 0.9, normalized: 'hello', reasoning: 'r', distance: 0.1, prompt: 'hello', hitCount: 1, updatedAt: Date.now() };
      const mockStore = { isReady: vi.fn(() => true), search: vi.fn(() => hit), incrementHit: vi.fn(), upsert: vi.fn(() => { throw new Error('upsert bg fail'); }), error: undefined };
      vi.mocked(getVectorStore).mockReturnValue(mockStore as unknown as ReturnType<typeof getVectorStore>);
      vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
      vi.mocked(runClassifier).mockResolvedValue({ tier: 'low' as RouterTier, reasoning: 'bg' });
      const stream = new MockEventStream();
      vi.mocked(createAssistantMessageEventStream).mockReturnValue(stream as unknown as AssistantMessageEventStream);
      setupDelegateSuccess();
      registerRouterProvider(mockPi, mockState, mockActions);
      const model = { id: 'balanced', api: 'router-api' as Api, provider: 'router' } as unknown as Model<Api>;
      const context = { messages: [{ role: 'user', content: 'hello' }] } as unknown as Context;
      registeredProviderOptions!.streamSimple(model, context);
      await new Promise((r) => setTimeout(r, 200));
      expect(notifyCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('backgroundRefresh failed'), 'warning');
    });
  });
});
