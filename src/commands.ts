import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import type { RouterConfig, RoutingDecision } from './types';
import { profileNames } from './config';
import { formatModelRef, formatDecision } from './ui';
import { getVectorStore, getExistingVectorStore } from './vector-store';

export const registerCommands = (
  pi: ExtensionAPI,
  state: {
    readonly currentConfig: RouterConfig;
    routerEnabled: boolean;
    selectedProfile: string | undefined;
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
    { name: 'debug', desc: 'Toggle or clear router debug history' },
    { name: 'reload', desc: 'Reload the model router configuration' },
    { name: 'cache', desc: 'Vector cache operations (status/clear)' },
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
      `Session cost: $${state.accumulatedCost.toFixed(4)}`,
      `Available profiles: ${names}`,
      `Last non-router model: ${formatModelRef(state.lastNonRouterModel)}`,
      `Debug: ${state.debugEnabled ? 'on' : 'off'}`,
      `Debug history: ${state.debugHistory.length} decisions`,
    ];
    if (state.lastDecision) {
      lines.push(
        `Last routed tier: ${state.lastDecision.tier}`,
        `Last model: ${state.lastDecision.targetProvider}/${state.lastDecision.targetModelId} (${state.lastDecision.thinking})`,
        `Reason: ${state.lastDecision.reasoning}`,
        ...(state.lastDecision.isVectorHit ? [`Vector hit: yes (similarity ${state.lastDecision.vectorSimilarity?.toFixed(2) ?? '?'})`] : []),
      );
    }
    // History size (top-level preferred, fallback to vectorCache)
    const effectiveHistorySize = state.currentConfig.historySize ?? state.currentConfig.vectorCache?.historySize ?? 0;
    lines.push('', `History size: ${effectiveHistorySize} (0=off, 1~20 recent messages)`);
    // Vector cache status
    const vc = state.currentConfig.vectorCache;
    if (vc) {
      lines.push(
        '',
        'Vector Cache:',
        `  enabled: ${vc.enabled ? 'yes' : 'no'}`,
        `  threshold: ${vc.threshold}`,
        `  vectorFile: ${vc.vectorFile}`,
        `  embeddingModel: ${vc.embeddingModel}`,
        `  embeddingBaseUrl: ${vc.embeddingBaseUrl}`,
        `  backgroundRefresh: ${vc.backgroundRefresh ? 'on' : 'off'}`,
        `  dimensions: ${vc.dimensions}`,
        `  embeddingContextWindow: ${vc.embeddingContextWindow}`,
        `  historySize (vectorCache, deprecated): ${vc.historySize ?? 0}`,
      );
      try {
        const store = vc.enabled ? (getExistingVectorStore() ?? getVectorStore(vc.vectorFile, vc.dimensions)) : undefined;
        if (store) {
          if (store.isReady()) {
            const stats = store.stats();
            lines.push(`  vectors: ${stats?.count ?? 0}`, `  dbPath: ${stats?.path ?? store.path}`);
          } else if (store.error) {
            lines.push(`  error: ${store.error}`);
          } else {
            lines.push(`  status: not initialized`);
          }
        }
      } catch {
        // ignore
      }
    } else {
      lines.push('', 'Vector Cache: disabled (no vectorCache config)');
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

  const handleCache = async (args: string[], ctx: ExtensionContext) => {
    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'status') {
      const vc = state.currentConfig.vectorCache;
      if (!vc) {
        ctx.ui.notify('Vector cache is not configured.', 'info');
        return;
      }
      const store = getExistingVectorStore() ?? getVectorStore(vc.vectorFile, vc.dimensions);
      if (!store) {
        ctx.ui.notify('Vector cache store unavailable.', 'error');
        return;
      }
      if (!store.isReady()) {
        ctx.ui.notify(`Vector cache not ready: ${store.error ?? 'unknown error'}`, 'error');
        return;
      }
      const stats = store.stats();
      ctx.ui.notify(`Vector cache: ${stats?.count ?? 0} vectors at ${stats?.path} (dim=${stats?.dimensions})`, 'info');
      return;
    }
    if (sub === 'clear') {
      const vc = state.currentConfig.vectorCache;
      if (!vc) {
        ctx.ui.notify('Vector cache is not configured.', 'error');
        return;
      }
      const store = getExistingVectorStore() ?? getVectorStore(vc.vectorFile, vc.dimensions);
      if (!store || !store.isReady()) {
        ctx.ui.notify(`Vector cache not ready: ${store?.error ?? 'unavailable'}`, 'error');
        return;
      }
      const ok = store.clear();
      ctx.ui.notify(ok ? 'Vector cache cleared.' : 'Failed to clear vector cache.', ok ? 'info' : 'error');
      return;
    }
    ctx.ui.notify('Usage: /router cache <status|clear>', 'error');
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
        case 'cache': {
          const cachePrefix = subArgs[0] ?? '';
          const items = ['status', 'clear']
            .filter((v) => v.startsWith(cachePrefix))
            .map((v) => ({
              value: `cache ${v}`,
              label: v,
              description: `Vector cache: ${v}`,
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
        case 'debug':
          await handleDebug(subArgs, ctx);
          break;
        case 'reload':
          await handleReload(subArgs, ctx);
          break;
        case 'status':
          await handleStatus(subArgs, ctx);
          break;
        case 'cache':
          await handleCache(subArgs, ctx);
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
              '  status                      Show current status, profile, cost, and last decision.',
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
