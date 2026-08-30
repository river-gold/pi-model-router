import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCommands } from './commands';
import type { RouterConfig, RoutingDecision, VectorCacheConfig } from './types';
import { getVectorStore, getExistingVectorStore } from './vector-store';

vi.mock('./vector-store', () => ({
  getVectorStore: vi.fn(),
  getExistingVectorStore: vi.fn(),
}));

describe('commands.ts', () => {
  const buildMockPi = () => {
    let registeredCommand: unknown = null;
    return {
      registerCommand: (name: string, cmd: unknown) => {
        if (name === 'router') {
          registeredCommand = cmd;
        }
      },
      setModel: vi.fn().mockResolvedValue(true),
      getRegisteredCommand: () => registeredCommand as {
        handler: (args: string, ctx: unknown) => Promise<void>;
        getArgumentCompletions: (prefix: string) => { value: string; label: string; description: string }[] | null;
      },
    };
  };

  const buildMockCtx = () => ({
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    modelRegistry: {
      find: vi.fn().mockImplementation((provider: string, modelId: string) => {
        if (provider === 'router' || provider === 'openai') {
          return { provider, id: modelId };
        }
        return null;
      }),
    },
    model: { provider: 'router', id: 'balanced' },
  });

  const buildDefaultState = () => {
    const config: RouterConfig = {
      profiles: {
        balanced: {
          high: { model: 'openai/gpt-4o' },
          medium: { model: 'openai/gpt-4o-mini' },
        },
        cheap: {
          low: { model: 'openai/gpt-4o-micro' },
        },
      },
    };

    const lastDecision: RoutingDecision = {
      profile: 'balanced',
      tier: 'medium',
      targetProvider: 'openai',
      targetModelId: 'gpt-4o-mini',
      targetLabel: 'openai/gpt-4o-mini',
      reasoning: 'Default reasoning',
      thinking: 'medium',
      timestamp: Date.now(),
    };

    return {
      currentConfig: config,
      routerEnabled: true,
      selectedProfile: 'balanced',
      lastDecision,
      lastNonRouterModel: 'openai/gpt-4o',
      accumulatedCost: 0.05,
      debugEnabled: false,
      debugHistory: [lastDecision],
      lastConfigWarnings: [] as string[],
    };
  };

  const buildMockActions = () => ({
    persistState: vi.fn(),
    updateStatus: vi.fn(),
    reloadConfig: vi.fn(),
    ensureValidActiveRouterProfile: vi.fn(),
  });

  const buildVectorCacheConfig = (overrides: Partial<VectorCacheConfig> = {}): VectorCacheConfig => ({
    enabled: true,
    threshold: 0.75,
    vectorFile: 'router-vectors.db',
    embeddingModel: 'qwen3-embedding:0.6b',
    embeddingBaseUrl: 'http://localhost:11434',
    backgroundRefresh: false,
    dimensions: 1024,
    embeddingContextWindow: 8192,
    ...overrides,
  });

  type MockStore = {
    isReady: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    error?: string;
    path: string;
  };

  const createMockStore = (overrides: Partial<MockStore> & { isReadyReturn?: boolean } = {}): MockStore => {
    const isReadyReturn = overrides.isReadyReturn ?? true;
    const base: MockStore = {
      isReady: overrides.isReady ?? vi.fn(() => isReadyReturn),
      stats: vi.fn(() => ({ count: 42, path: '/tmp/vec.db', dimensions: 1024 })),
      clear: vi.fn(() => true),
      path: '/tmp/vec.db',
    };
    // apply overrides except isReadyReturn
    const { isReadyReturn: _ignored, ...rest } = overrides;
    return { ...base, ...rest, isReady: base.isReady };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVectorStore).mockReset();
    vi.mocked(getExistingVectorStore).mockReset();
    vi.mocked(getExistingVectorStore).mockReturnValue(undefined);
    vi.mocked(getVectorStore).mockReturnValue(undefined);
  });

  describe('Registration & Subcommand Completion', () => {
    it('should register router command', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      expect(pi.getRegisteredCommand()).toBeDefined();
    });

    it('should autocomplete subcommands', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('');
      expect(completions).toBeDefined();
      const names = (completions as { value: string }[]).map((c) => c.value);
      expect(names).toContain('status');
      expect(names).not.toContain('profile');
      expect(names).not.toContain('pin');
    });


  });

  describe('Handler Subcommands', () => {
    it('should handle /router status', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalled();
      const notifyMessage = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(notifyMessage).toContain('Model Router Status:');
      expect(notifyMessage).toContain('Selected profile: balanced');
      expect(actions.updateStatus).toHaveBeenCalledWith(ctx);
    });






    it('should handle /router debug history control', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug show', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Recent Routing Decisions'),
        'info',
      );

      await cmd.handler('debug clear', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(state.debugHistory.length).toBe(0);
    });

    it('should handle /router reload config', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('reload', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(actions.reloadConfig).toHaveBeenCalledWith(ctx, {
        preserveDebug: true,
      });
      expect(actions.ensureValidActiveRouterProfile).toHaveBeenCalledWith(ctx);
    });
  });

  describe('handleStatus edge cases', () => {
    it('should show error when status has extra args', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status extra', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Usage: /router status (no arguments)',
        'error',
      );
    });

    it('should handle status without lastDecision', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      (state as unknown as { lastDecision: RoutingDecision | undefined }).lastDecision = undefined;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const notifyMessage = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(notifyMessage).toContain('Model Router Status:');
      expect(notifyMessage).not.toContain('Last routed tier:');
    });

    it('should show config warnings in status', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      (state as unknown as { lastConfigWarnings: string[] }).lastConfigWarnings = ['Warning 1', 'Warning 2'];
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const notifyMessage = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(notifyMessage).toContain('⚠️ Configuration Warnings:');
      expect(notifyMessage).toContain('Warning 1');
      expect(notifyMessage).toContain('Warning 2');
    });

  });





  describe('handleDebug edge cases', () => {
    it('should enable debug explicitly', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugEnabled = false;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug on', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(state.debugEnabled).toBe(true);
      expect(actions.persistState).toHaveBeenCalled();
    });

    it('should disable debug explicitly', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugEnabled = true;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug off', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(state.debugEnabled).toBe(false);
      expect(actions.persistState).toHaveBeenCalled();
    });

    it('should toggle debug when no arg given', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugEnabled = false;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(state.debugEnabled).toBe(true);

      await cmd.handler('debug', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(state.debugEnabled).toBe(false);
    });

    it('should show message when debug history is empty', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugHistory.length = 0;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug show', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'No recent routing decisions.',
        'info',
      );
    });

    it('should show error with too many args', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug on extra', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Usage: /router debug <on|off|show|clear>',
        'error',
      );
    });
  });

  describe('handleReload edge cases', () => {
    it('should show error with extra args', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('reload extra', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Usage: /router reload (no arguments)',
        'error',
      );
    });
  });

  describe('Autocomplete completions', () => {




    it('should return debug completions', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('debug ');
      expect(completions).toBeDefined();
      const values = (completions as { value: string }[]).map((c) => c.value);
      expect(values).toContain('debug on');
      expect(values).toContain('debug off');
      expect(values).toContain('debug show');
      expect(values).toContain('debug clear');
    });

    it('should return null for unknown subcommand completions', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('unknown ');
      expect(completions).toBeNull();
    });

    it('should filter subcommand completions by prefix', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('st');
      expect(completions).toBeDefined();
      const values = (completions as { value: string }[]).map((c) => c.value);
      expect(values).toContain('status');
      expect(values).not.toContain('profile');
    });
  });

  describe('Default handler branch', () => {
    it('should show error for unknown subcommand', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('nonexistent', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Unknown router subcommand: nonexistent'),
        'error',
      );
    });



    it('should fall through to status on empty args', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Model Router Status:'),
        'info',
      );
    });

    it('should show help with /router help', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('help', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Router Subcommands:'),
        'info',
      );
    });

    it('should show help with /router ?', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('?', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Router Subcommands:'),
        'info',
      );
    });

    it('should show error when help has extra args', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('help extra', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Usage: /router help (no arguments)',
        'error',
      );
    });
  });

  describe('vector cache commands', () => {
    it('should notify not configured for cache status when vectorCache missing', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      // ensure no vectorCache
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache is not configured.', 'info');

      vi.clearAllMocks();
      await cmd.handler('cache', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache is not configured.', 'info');
    });

    it('should notify not configured for cache clear when vectorCache missing', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache clear', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache is not configured.', 'error');
    });

    it('should error when cache status store not ready', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const notReadyStore = createMockStore({ isReadyReturn: false, error: 'init failed' });
      // need to ensure error prop accessible
      (notReadyStore as unknown as Record<string, unknown>).error = 'init failed';
      vi.mocked(getExistingVectorStore).mockReturnValue(undefined);
      vi.mocked(getVectorStore).mockReturnValue(notReadyStore as unknown as import('./vector-store').VectorStore);

      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache not ready: init failed', 'error');
      expect(vi.mocked(getVectorStore)).toHaveBeenCalledWith('router-vectors.db', 1024);
    });

    it('should error with unknown error when store error undefined', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const notReadyStore = createMockStore({ isReadyReturn: false });
      // no error property
      vi.mocked(getVectorStore).mockReturnValue(notReadyStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();
      await cmd.handler('cache', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache not ready: unknown error', 'error');
    });

    it('should error when cache status store unavailable', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      vi.mocked(getExistingVectorStore).mockReturnValue(undefined);
      vi.mocked(getVectorStore).mockReturnValue(undefined);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();
      await cmd.handler('cache status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache store unavailable.', 'error');
    });

    it('should show vector count when cache status ready', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const readyStore = createMockStore({ isReadyReturn: true });
      readyStore.stats = vi.fn(() => ({ count: 7, path: '/tmp/vec.db', dimensions: 1024 }));
      vi.mocked(getExistingVectorStore).mockReturnValue(readyStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache: 7 vectors at /tmp/vec.db (dim=1024)', 'info');

      // also via implicit status (no sub)
      vi.clearAllMocks();
      // need re-mock because clearAllMocks cleared call history but mockReturnValue remains? Actually clearAllMocks keeps implementation but clears calls; but we cleared mocks earlier? We'll re-setup
      vi.mocked(getExistingVectorStore).mockReturnValue(readyStore as unknown as import('./vector-store').VectorStore);
      await cmd.handler('cache', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache: 7 vectors at /tmp/vec.db (dim=1024)', 'info');
    });

    it('should prefer existing store over getVectorStore', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const existing = createMockStore({ isReadyReturn: true });
      existing.stats = vi.fn(() => ({ count: 3, path: '/tmp/existing.db', dimensions: 1024 }));
      vi.mocked(getExistingVectorStore).mockReturnValue(existing as unknown as import('./vector-store').VectorStore);
      vi.mocked(getVectorStore).mockReturnValue(undefined);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();
      await cmd.handler('cache status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('3 vectors'), 'info');
      expect(vi.mocked(getVectorStore)).not.toHaveBeenCalled();
    });

    it('should clear cache successfully', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const readyStore = createMockStore({ isReadyReturn: true });
      readyStore.clear = vi.fn(() => true);
      vi.mocked(getVectorStore).mockReturnValue(readyStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache clear', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(readyStore.clear).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache cleared.', 'info');
    });

    it('should notify failure when clear returns false', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const readyStore = createMockStore({ isReadyReturn: true });
      readyStore.clear = vi.fn(() => false);
      vi.mocked(getVectorStore).mockReturnValue(readyStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache clear', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Failed to clear vector cache.', 'error');
    });

    it('should error when cache clear store not ready', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const notReady = createMockStore({ isReadyReturn: false });
      (notReady as unknown as Record<string, unknown>).error = 'db error';
      vi.mocked(getVectorStore).mockReturnValue(notReady as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache clear', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Vector cache not ready: db error', 'error');
    });

    it('should show usage error for unknown cache subcommand', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig();
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('cache bogus', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Usage: /router cache <status|clear>', 'error');

      await cmd.handler('cache unknown', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith('Usage: /router cache <status|clear>', 'error');
    });
  });

  describe('cache autocomplete', () => {
    it('should return cache status/clear completions', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('cache ');
      expect(completions).not.toBeNull();
      const values = (completions as { value: string }[]).map((c) => c.value);
      expect(values).toContain('cache status');
      expect(values).toContain('cache clear');
    });

    it('should filter cache completions by prefix', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completionsS = cmd.getArgumentCompletions('cache s');
      expect(completionsS).not.toBeNull();
      const valuesS = (completionsS as { value: string }[]).map((c) => c.value);
      expect(valuesS).toContain('cache status');
      expect(valuesS).not.toContain('cache clear');

      const completionsC = cmd.getArgumentCompletions('cache c');
      expect(completionsC).not.toBeNull();
      const valuesC = (completionsC as { value: string }[]).map((c) => c.value);
      expect(valuesC).toContain('cache clear');
      expect(valuesC).not.toContain('cache status');

      const completionsX = cmd.getArgumentCompletions('cache x');
      expect(completionsX).toBeNull();
    });

    it('should handle cache autocomplete with trailing space after subcommand', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('cache status ');
      expect(completions).not.toBeNull();
      const values = (completions as { value: string }[]).map((c) => c.value);
      expect(values).toContain('cache status');
    });
  });

  describe('handleStatus vectorCache lines', () => {
    it('should include disabled line when vectorCache not configured', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      // ensure undefined
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(msg).toContain('Vector Cache: disabled (no vectorCache config)');
    });

    it('should include vectorCache lines when enabled and store ready', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig({
        enabled: true,
        threshold: 0.88,
        vectorFile: 'my.db',
        embeddingModel: 'my-model',
        embeddingBaseUrl: 'http://localhost:11434',
        dimensions: 768,
        backgroundRefresh: true,
        embeddingContextWindow: 4096,
      });
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const readyStore = createMockStore({ isReadyReturn: true });
      readyStore.stats = vi.fn(() => ({ count: 12, path: '/tmp/my.db', dimensions: 768 }));
      vi.mocked(getExistingVectorStore).mockReturnValue(readyStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(msg).toContain('Vector Cache:');
      expect(msg).toContain('enabled: yes');
      expect(msg).toContain('threshold: 0.88');
      expect(msg).toContain('vectorFile: my.db');
      expect(msg).toContain('embeddingModel: my-model');
      expect(msg).toContain('dimensions: 768');
      expect(msg).toContain('backgroundRefresh: on');
      expect(msg).toContain('vectors: 12');
      expect(msg).toContain('dbPath: /tmp/my.db');
    });

    it('should show not initialized when store exists but not ready and no error', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig({ enabled: true });
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const notReadyNoError = createMockStore({ isReadyReturn: false });
      // ensure error undefined
      delete (notReadyNoError as unknown as Record<string, unknown>).error;
      vi.mocked(getExistingVectorStore).mockReturnValue(notReadyNoError as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(msg).toContain('status: not initialized');
    });

    it('should show error line when store has error', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig({ enabled: true });
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const errorStore = createMockStore({ isReadyReturn: false });
      (errorStore as unknown as Record<string, unknown>).error = 'disk full';
      vi.mocked(getExistingVectorStore).mockReturnValue(errorStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(msg).toContain('error: disk full');
    });

    it('should show enabled: no when vectorCache disabled', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig({ enabled: false });
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      // when disabled, handleStatus should not query store
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(msg).toContain('Vector Cache:');
      expect(msg).toContain('enabled: no');
      expect(msg).not.toContain('vectors:');
      expect(vi.mocked(getExistingVectorStore)).not.toHaveBeenCalled();
      expect(vi.mocked(getVectorStore)).not.toHaveBeenCalled();
    });

    it('should handle vectorCache via getVectorStore fallback when no existing store', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.currentConfig.vectorCache = buildVectorCacheConfig({ enabled: true });
      const actions = buildMockActions();
      const ctx = buildMockCtx();
      const fallbackStore = createMockStore({ isReadyReturn: true });
      fallbackStore.stats = vi.fn(() => ({ count: 5, path: '/tmp/fallback.db', dimensions: 1024 }));
      vi.mocked(getExistingVectorStore).mockReturnValue(undefined);
      vi.mocked(getVectorStore).mockReturnValue(fallbackStore as unknown as import('./vector-store').VectorStore);
      registerCommands(pi as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI, state as unknown as Parameters<typeof registerCommands>[1], actions as unknown as Parameters<typeof registerCommands>[2]);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
      const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(msg).toContain('vectors: 5');
      expect(vi.mocked(getVectorStore)).toHaveBeenCalledWith('router-vectors.db', 1024);
    });
  });
});

