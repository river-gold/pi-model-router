import { describe, it, expect, vi } from 'vitest';
import { registerCommands } from './commands';
import type { RouterConfig, RoutingDecision } from './types';

describe('commands.ts', () => {
  const buildMockPi = () => {
    let registeredCommand: any = null;
    return {
      registerCommand: (name: string, cmd: any) => {
        if (name === 'router') {
          registeredCommand = cmd;
        }
      },
      setModel: vi.fn().mockResolvedValue(true),
      getRegisteredCommand: () => registeredCommand,
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
      tier: 'medium',      targetProvider: 'openai',
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
      lastConfigWarnings: [],
    };
  };

  const buildMockActions = () => ({
    persistState: vi.fn(),
    updateStatus: vi.fn(),
    reloadConfig: vi.fn(),
    ensureValidActiveRouterProfile: vi.fn(),
  });

  describe('Registration & Subcommand Completion', () => {
    it('should register router command', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as any, state as any, actions as any);
      expect(pi.getRegisteredCommand()).toBeDefined();
    });

    it('should autocomplete subcommands', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('');
      expect(completions).toBeDefined();
      const names = completions.map((c: any) => c.value);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as any);
      expect(ctx.ui.notify).toHaveBeenCalled();
      const notifyMessage = ctx.ui.notify.mock.calls[0][0];
      expect(notifyMessage).toContain('Model Router Status:');
      expect(notifyMessage).toContain('Selected profile: balanced');
      expect(actions.updateStatus).toHaveBeenCalledWith(ctx);
    });






    it('should handle /router debug history control', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug show', ctx as any);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Recent Routing Decisions'),
        'info',
      );

      await cmd.handler('debug clear', ctx as any);
      expect(state.debugHistory.length).toBe(0);
    });

    it('should handle /router reload config', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('reload', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status extra', ctx as any);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Usage: /router status (no arguments)',
        'error',
      );
    });

    it('should handle status without lastDecision', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      (state as any).lastDecision = undefined;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as any);
      const notifyMessage = ctx.ui.notify.mock.calls[0][0];
      expect(notifyMessage).toContain('Model Router Status:');
      expect(notifyMessage).not.toContain('Last routed tier:');
    });

    it('should show config warnings in status', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      (state as any).lastConfigWarnings = ['Warning 1', 'Warning 2'];
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('status', ctx as any);
      const notifyMessage = ctx.ui.notify.mock.calls[0][0];
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug on', ctx as any);
      expect(state.debugEnabled).toBe(true);
      expect(actions.persistState).toHaveBeenCalled();
    });

    it('should disable debug explicitly', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugEnabled = true;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug off', ctx as any);
      expect(state.debugEnabled).toBe(false);
      expect(actions.persistState).toHaveBeenCalled();
    });

    it('should toggle debug when no arg given', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugEnabled = false;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug', ctx as any);
      expect(state.debugEnabled).toBe(true);

      await cmd.handler('debug', ctx as any);
      expect(state.debugEnabled).toBe(false);
    });

    it('should show message when debug history is empty', async () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      state.debugHistory.length = 0;
      const actions = buildMockActions();
      const ctx = buildMockCtx();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug show', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('debug on extra', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('reload extra', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('debug ');
      expect(completions).toBeDefined();
      const values = completions!.map((c: any) => c.value);
      expect(values).toContain('debug on');
      expect(values).toContain('debug off');
      expect(values).toContain('debug show');
      expect(values).toContain('debug clear');
    });

    it('should return null for unknown subcommand completions', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('unknown ');
      expect(completions).toBeNull();
    });

    it('should filter subcommand completions by prefix', () => {
      const pi = buildMockPi();
      const state = buildDefaultState();
      const actions = buildMockActions();

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      const completions = cmd.getArgumentCompletions('st');
      expect(completions).toBeDefined();
      const values = completions!.map((c: any) => c.value);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('nonexistent', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('help', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('?', ctx as any);
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

      registerCommands(pi as any, state as any, actions as any);
      const cmd = pi.getRegisteredCommand();

      await cmd.handler('help extra', ctx as any);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Usage: /router help (no arguments)',
        'error',
      );
    });
  });
});
