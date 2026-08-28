import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import type {
  RouterConfig,
  RouterPinByProfile,
  RouterThinkingByProfile,
  RoutingDecision,
  RouterTier,
} from './types';
import {
  profileNames,
  ROUTER_PIN_VALUES,
  ROUTER_TIERS,
  parseCanonicalModelRef,
} from './config';
import {
  formatPinSummary,
  formatThinkingSummary,
  formatModelRef,
  formatDecision,
} from './ui';

export const registerCommands = (
  pi: ExtensionAPI,
  state: {
    readonly currentConfig: RouterConfig;
    routerEnabled: boolean;
    selectedProfile: string | undefined;
    readonly pinnedTierByProfile: RouterPinByProfile;
    readonly thinkingByProfile: RouterThinkingByProfile;
    readonly lastDecision: RoutingDecision | undefined;
    lastNonRouterModel: string | undefined;
    readonly accumulatedCost: number;
    debugEnabled: boolean;
    readonly debugHistory: RoutingDecision[];
    readonly lastConfigWarnings: string[];
  },
  actions: {
    persistState: () => void;
    updateStatus: (ctx: ExtensionContext) => void;
    reloadConfig: (
      ctx?: ExtensionContext,
      options?: { preserveDebug?: boolean },
    ) => void;
    ensureValidActiveRouterProfile: (ctx: ExtensionContext) => Promise<void>;
  },
) => {
  const SUBCOMMAND_DETAILS = [
    { name: 'status', desc: 'Show current router status' },
    { name: 'pin', desc: 'Pin routing for a profile to a specific tier' },
    { name: 'disable', desc: 'Disable the router and restore last model' },
    { name: 'debug', desc: 'Toggle or clear router debug history' },
    { name: 'reload', desc: 'Reload the model router configuration' },
    { name: 'help', desc: 'Show usage help for subcommands' },
  ];

  const getSubcommandCompletions = (
    prefix: string,
  ): AutocompleteItem[] | null => {
    const items = SUBCOMMAND_DETAILS.filter((s) =>
      s.name.startsWith(prefix),
    ).map((s) => ({
      value: s.name,
      label: s.name,
      description: s.desc,
    }));
    return items.length > 0 ? items : null;
  };

  const getPinCompletions = (args: string[]): AutocompleteItem[] | null => {
    // pin <tier|auto>
    if (args.length <= 1) {
      const token = args[0] ?? '';
      const items = ROUTER_PIN_VALUES.filter((value) =>
        value.startsWith(token),
      ).map((value) => ({
        value,
        label: value,
        description: value === 'auto'
          ? 'Restore auto-routing (clear pin) for the active profile'
          : `Pin active profile to ${value} tier`,
      }));
      return items.length > 0 ? items : null;
    }
    return null;
  };


  const handleStatus = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 0) {
      ctx.ui.notify('Usage: /router status (no arguments)', 'error');
      return;
    }
    const names = profileNames(state.currentConfig).join(', ');
    const lines = [
      'Model Router Status:',
      `Router enabled: ${state.routerEnabled ? 'yes' : 'off'}`,
      `Selected profile: ${state.selectedProfile ?? 'none'}`,
      `Selected profile pin: ${state.selectedProfile ? (state.pinnedTierByProfile[state.selectedProfile] ?? 'auto') : 'none'}`,
      `Pins by profile: ${formatPinSummary(state.pinnedTierByProfile)}`,
      `Thinking overrides: ${formatThinkingSummary(state.thinkingByProfile)}`,
      `Session cost: $${state.accumulatedCost.toFixed(4)}`,
      `Available profiles: ${names}`,
      `Last non-router model: ${formatModelRef(state.lastNonRouterModel)}`,
      `Debug: ${state.debugEnabled ? 'on' : 'off'}`,
      `Debug history: ${state.debugHistory.length} decisions`,
    ];
    if (state.lastDecision) {
      lines.push(
        `Last routed tier: ${state.lastDecision.tier}`,
        `Last phase: ${state.lastDecision.phase}`,
        `Last model: ${state.lastDecision.targetProvider}/${state.lastDecision.targetModelId} (${state.lastDecision.thinking})`,
        `Reason: ${state.lastDecision.reasoning}`,
      );
    }
    if (state.lastConfigWarnings && state.lastConfigWarnings.length > 0) {
      lines.push(
        '',
        '⚠️ Configuration Warnings:',
        ...state.lastConfigWarnings.map((w) => `  - ${w}`),
      );
    }
    ctx.ui.notify(lines.join('\n'), 'info');
    actions.updateStatus(ctx);
  };

  const handlePin = async (args: string[], ctx: ExtensionContext) => {
    const currentProfile = state.selectedProfile;
    if (!currentProfile) {
      ctx.ui.notify('No router profile is active. Select a router model first.', 'error');
      return;
    }
    if (args.length === 0) {
      ctx.ui.notify(
        [
          `Profile: ${currentProfile}`,
          `Pinned tier: ${state.pinnedTierByProfile[currentProfile] ?? 'auto'}`,
          `Usage: /router pin <high|medium|low|auto>`,
        ].join('\n'),
        'info',
      );
      actions.updateStatus(ctx);
      return;
    }

    if (args.length > 1) {
      ctx.ui.notify(
        'Usage: /router pin <high|medium|low|auto>',
        'error',
      );
      return;
    }

    const pinValue = args[0];

    if (!ROUTER_PIN_VALUES.includes(pinValue as any)) {
      ctx.ui.notify(
        `Invalid router pin: ${pinValue}. Use one of: ${ROUTER_PIN_VALUES.join(', ')}`,
        'error',
      );
      return;
    }

    const nextTier = pinValue === 'auto' ? undefined : (pinValue as RouterTier);
    if (nextTier) {
      state.pinnedTierByProfile[currentProfile] = nextTier;
    } else {
      delete state.pinnedTierByProfile[currentProfile];
    }
    actions.persistState();
    actions.updateStatus(ctx);
    ctx.ui.notify(
      nextTier
        ? `Router pinned to ${nextTier}`
        : `Router pin cleared; heuristic routing restored`,
      'info',
    );
  };

  const handleDisable = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 0) {
      ctx.ui.notify('Usage: /router disable (no arguments)', 'error');
      return;
    }
    if (!state.lastNonRouterModel) {
      ctx.ui.notify(
        'No previous non-router model recorded. Use /model to pick a concrete model.',
        'warning',
      );
      return;
    }
    const { provider, modelId } = parseCanonicalModelRef(
      state.lastNonRouterModel,
    );
    const targetModel = ctx.modelRegistry.find(provider, modelId);
    if (!targetModel) {
      ctx.ui.notify(
        `Recorded non-router model is unavailable: ${state.lastNonRouterModel}`,
        'error',
      );
      return;
    }
    const success = await pi.setModel(targetModel);
    if (!success) {
      ctx.ui.notify(`Failed to switch to ${state.lastNonRouterModel}`, 'error');
      return;
    }
    state.routerEnabled = false;
    actions.persistState();
    actions.updateStatus(ctx);
    ctx.ui.notify(
      `Router disabled. Restored ${state.lastNonRouterModel}`,
      'info',
    );
  };

  const handleDebug = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 1) {
      ctx.ui.notify('Usage: /router debug <on|off|show|clear>', 'error');
      return;
    }
    const cmd = args[0]?.toLowerCase();
    if (cmd === 'on') state.debugEnabled = true;
    else if (cmd === 'off') state.debugEnabled = false;
    else if (cmd === 'clear') state.debugHistory.length = 0;
    else if (cmd === 'show') {
      if (state.debugHistory.length === 0) {
        ctx.ui.notify('No recent routing decisions.', 'info');
      } else {
        const history = state.debugHistory
          .map(
            (d) =>
              `[${new Date(d.timestamp).toLocaleTimeString()}] ${formatDecision(d)}`,
          )
          .join('\n');
        ctx.ui.notify(`Recent Routing Decisions:\n${history}`, 'info');
      }
      return;
    } else {
      state.debugEnabled = !state.debugEnabled;
    }
    actions.persistState();
    ctx.ui.notify(
      `Router debug ${state.debugEnabled ? 'enabled' : 'disabled'}.`,
      'info',
    );
  };

  const handleReload = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 0) {
      ctx.ui.notify('Usage: /router reload (no arguments)', 'error');
      return;
    }
    actions.reloadConfig(ctx, { preserveDebug: true });
    await actions.ensureValidActiveRouterProfile(ctx);
    ctx.ui.notify(
      `Router config reloaded. Profiles: ${profileNames(state.currentConfig).join(', ')}`,
      'info',
    );
  };

  pi.registerCommand('router', {
    description: 'Model router control center',
    getArgumentCompletions: (prefix) => {
      const trimmedLeft = prefix.trimStart();
      const hasTrailingSpace = /\s$/.test(prefix);
      const parts = trimmedLeft.length > 0 ? trimmedLeft.split(/\s+/) : [];

      if (parts.length === 0) {
        return getSubcommandCompletions('');
      }

      if (parts.length === 1 && !hasTrailingSpace) {
        return getSubcommandCompletions(parts[0]);
      }

      const subcommand = parts[0];
      const subArgs = parts.slice(1);
      if (hasTrailingSpace && parts.length === 1) {
        subArgs.push('');
      }

      switch (subcommand) {
        case 'pin': {
          const completions = getPinCompletions(subArgs);
          return (
            completions?.map((c) => ({
              ...c,
              value: `pin ${c.value}`,
              description: c.description ?? `Pin routing to ${c.label}`,
            })) ?? null
          );
        }
        case 'debug': {
          const debugPrefix = subArgs[0] ?? '';
          const items = ['on', 'off', 'toggle', 'clear', 'show']
            .filter((v) => v.startsWith(debugPrefix))
            .map((v) => ({
              value: `debug ${v}`,
              label: v,
              description: `Router debug: ${v}`,
            }));
          return items.length > 0 ? items : null;
        }
      }

      return null;
    },
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) ?? [];
      const subcommand = parts[0];
      const subArgs = parts.slice(1);

      switch (subcommand) {
        case 'pin':
          await handlePin(subArgs, ctx);
          break;
        case 'disable':
          await handleDisable(subArgs, ctx);
          break;
        case 'debug':
          await handleDebug(subArgs, ctx);
          break;
        case 'reload':
          await handleReload(subArgs, ctx);
          break;
        case 'status':
          await handleStatus(subArgs, ctx);
          break;
        case 'help':
        case '?':
          if (subArgs.length > 0) {
            ctx.ui.notify('Usage: /router help (no arguments)', 'error');
            return;
          }
          ctx.ui.notify(
            [
              'Router Subcommands:',
              '  status                      Show current status, profile, pin, cost, and last decision.',
              '  pin <tier|auto>             Force a tier (high|medium|low) or set to auto.',
              '  disable                     Disable the router and restore the last used non-router model.',
              '  debug <on|off|show|clear>   Control routing debug logging to notifications and history.',
              '  reload                      Hot-reload the configuration JSON from .pi/model-router.json.',
              '  help, ?                     Show this help message.',
            ].join('\n'),
            'info',
          );
          break;
        default:
          if (subcommand) {
            ctx.ui.notify(
              `Unknown router subcommand: ${subcommand}. Try /router help`,
              'error',
            );
          } else {
            await handleStatus(subArgs, ctx);
          }
          break;
      }
    },
  });
};
