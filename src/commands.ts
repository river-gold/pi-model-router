import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { RouterConfig, RoutingDecision } from "./types";
import { profileNames } from "./config";
import { formatModelRef, formatDecision } from "./ui";

export const SUBCOMMAND_DETAILS = [
  { name: "status", desc: "Show current router status" },
  { name: "debug", desc: "Toggle or clear router debug history" },
  { name: "reload", desc: "Reload the model router configuration" },
  { name: "reset-failures", desc: "Clear session failure memory (chain-local, in-memory)" },
  { name: "clear-failures", desc: "Alias for reset-failures" },
  { name: "help", desc: "Show usage help for subcommands" },
] as const;

const USAGE_STATUS = "Usage: /router status (no arguments)";
const USAGE_DEBUG = "Usage: /router debug <on|off|toggle|show|clear>";
const USAGE_RELOAD = "Usage: /router reload (no arguments)";
const USAGE_RESET = "Usage: /router reset-failures (no arguments)";
const USAGE_HELP = "Usage: /router help (no arguments)";

const HELP_LINES = [
  "Router Subcommands:",
  "  status                           Show current status, profile, cost, and last decision.",
  "  debug <on|off|toggle|show|clear> Control routing debug logging to notifications and history.",
  "  reload                           Hot-reload the configuration JSON from .pi/model-router.json.",
  "  reset-failures, clear-failures   Clear session failure memory (in-memory, chain-local).",
  "  help, ?                          Show this help message.",
];

type RouterStateView = {
  readonly currentConfig: RouterConfig;
  routerEnabled: boolean;
  selectedProfile: string | undefined;
  readonly lastDecision: RoutingDecision | undefined;
  lastNonRouterModel: string | undefined;
  readonly accumulatedCost: number;
  debugEnabled: boolean;
  debugHistory: RoutingDecision[];
  readonly lastConfigWarnings: string[];
  readonly failedByChain: Map<string, Set<string>>;
};

const formatThinking = (thinking: string | undefined): string => thinking ?? "auto";

export const formatStatusLines = (state: RouterStateView): string[] => {
  const names = profileNames(state.currentConfig).join(", ");
  const lines = [
    "Model Router Status:",
    `Router enabled: ${state.routerEnabled ? "yes" : "off"}`,
    `Selected profile: ${state.selectedProfile ?? "none"}`,
    `Session cost: $${state.accumulatedCost.toFixed(4)}`,
    `Available profiles: ${names}`,
    `Last non-router model: ${formatModelRef(state.lastNonRouterModel)}`,
    `Debug: ${state.debugEnabled ? "on" : "off"}`,
    `Debug history: ${state.debugHistory.length} decisions`,
  ];
  if (state.lastDecision) {
    lines.push(
      `Last routed tier: ${state.lastDecision.tier}`,
      `Last model: ${state.lastDecision.targetProvider}/${state.lastDecision.targetModelId} (${formatThinking(state.lastDecision.thinking)})`,
      `Reason: ${state.lastDecision.reasoning}`,
    );
  }
  const historySize = state.currentConfig.historySize ?? 0;
  lines.push("", `History size: ${historySize} (0=off, 1~20 pairs)`);
  if (state.failedByChain.size === 0) {
    lines.push("Session failures: none (in-memory, chain-local)");
  } else {
    lines.push("Session failures (in-memory, chain-local):");
    for (const [chain, set] of state.failedByChain.entries()) {
      if (set.size === 0) continue;
      lines.push(`  ${chain}: ${[...set].join(", ")}`);
    }
  }
  if (state.lastConfigWarnings.length > 0) {
    lines.push("", "⚠️ Configuration Warnings:", ...state.lastConfigWarnings.map((w) => `  - ${w}`));
  }
  return lines;
};

export const buildDebugShowMessage = (history: RoutingDecision[]): string => {
  if (history.length === 0) return "No recent routing decisions.";
  const lines = history.map((d) => `[${new Date(d.timestamp).toLocaleTimeString()}] ${formatDecision(d)}`);
  return `Recent Routing Decisions:\n${lines.join("\n")}`;
};

export const parsePrefix = (
  prefix: string,
): { subcommand: string; subArgs: string[]; hasTrailingSpace: boolean } => {
  const trimmedLeft = prefix.trimStart();
  const hasTrailingSpace = /\s$/.test(prefix);
  if (trimmedLeft.length === 0) return { subcommand: "", subArgs: [], hasTrailingSpace: false };
  const parts = trimmedLeft.split(/\s+/);
  return { subcommand: parts[0], subArgs: parts.slice(1), hasTrailingSpace };
};

export const parseArgs = (
  args: string | undefined,
): { subcommand: string | undefined; subArgs: string[] } => {
  const trimmed = args?.trim() ?? "";
  if (trimmed === "") return { subcommand: undefined, subArgs: [] };
  const parts = trimmed.split(/\s+/);
  return { subcommand: parts[0], subArgs: parts.slice(1) };
};

const getSubcommandCompletions = (prefix: string): AutocompleteItem[] | null => {
  const items = SUBCOMMAND_DETAILS.filter((s) => s.name.startsWith(prefix)).map((s) => ({
    value: s.name,
    label: s.name,
    description: s.desc,
  }));
  return items.length > 0 ? items : null;
};

export const registerCommands = (
  pi: ExtensionAPI,
  state: RouterStateView,
  actions: {
    persistState: () => void;
    updateStatus: (ctx: ExtensionContext) => void;
    reloadConfig: (ctx?: ExtensionContext, options?: { preserveDebug?: boolean }) => void;
    ensureValidActiveRouterProfile: (ctx: ExtensionContext) => Promise<void>;
  },
) => {
  const handleStatus = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 0) {
      ctx.ui.notify(USAGE_STATUS, "error");
      return;
    }
    ctx.ui.notify(formatStatusLines(state).join("\n"), "info");
    actions.updateStatus(ctx);
  };

  const handleDebug = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 1) {
      ctx.ui.notify(USAGE_DEBUG, "error");
      return;
    }
    const cmd = args[0]?.toLowerCase();
    if (cmd === "on") state.debugEnabled = true;
    else if (cmd === "off") state.debugEnabled = false;
    else if (cmd === "toggle") state.debugEnabled = !state.debugEnabled;
    else if (cmd === "clear") {
      state.debugHistory = [];
      actions.persistState();
      ctx.ui.notify("Router debug cleared.", "info");
      return;
    } else if (cmd === "show") {
      ctx.ui.notify(buildDebugShowMessage(state.debugHistory), "info");
      return;
    } else if (cmd === undefined || cmd === "") {
      state.debugEnabled = !state.debugEnabled;
    } else {
      ctx.ui.notify(USAGE_DEBUG, "error");
      return;
    }
    actions.persistState();
    ctx.ui.notify(`Router debug ${state.debugEnabled ? "enabled" : "disabled"}.`, "info");
  };

  const handleReload = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 0) {
      ctx.ui.notify(USAGE_RELOAD, "error");
      return;
    }
    actions.reloadConfig(ctx, { preserveDebug: true });
    await actions.ensureValidActiveRouterProfile(ctx);
    ctx.ui.notify(`Router config reloaded. Profiles: ${profileNames(state.currentConfig).join(", ")}`, "info");
  };

  const handleResetFailures = async (args: string[], ctx: ExtensionContext) => {
    if (args.length > 0) {
      ctx.ui.notify(USAGE_RESET, "error");
      return;
    }
    state.failedByChain.clear();
    ctx.ui.notify("Router session failures cleared (in-memory, chain-local).", "info");
  };

  pi.registerCommand("router", {
    description: "Model router control center",
    getArgumentCompletions: (prefix) => {
      const { subcommand, subArgs, hasTrailingSpace } = parsePrefix(prefix);
      if (subcommand === "") return getSubcommandCompletions("");
      if (subArgs.length === 0 && !hasTrailingSpace && subcommand !== "debug") return getSubcommandCompletions(subcommand);
      if (subcommand === "debug") {
        const debugPrefix = subArgs[0] ?? "";
        const items = ["on", "off", "toggle", "clear", "show"]
          .filter((v) => v.startsWith(debugPrefix))
          .map((v) => ({ value: `debug ${v}`, label: v, description: `Router debug: ${v}` }));
        return items.length > 0 ? items : null;
      }
      return null;
    },
    handler: async (args, ctx) => {
      const { subcommand, subArgs } = parseArgs(args);
      switch (subcommand) {
        case "debug":
          await handleDebug(subArgs, ctx);
          break;
        case "reload":
          await handleReload(subArgs, ctx);
          break;
        case "status":
          await handleStatus(subArgs, ctx);
          break;
        case "reset-failures":
        case "clear-failures":
          await handleResetFailures(subArgs, ctx);
          break;
        case "help":
        case "?":
          if (subArgs.length > 0) {
            ctx.ui.notify(USAGE_HELP, "error");
            return;
          }
          ctx.ui.notify(HELP_LINES.join("\n"), "info");
          break;
        default:
          if (subcommand) {
            ctx.ui.notify(`Unknown router subcommand: ${subcommand}. Try /router help`, "error");
          } else {
            await handleStatus(subArgs, ctx);
          }
          break;
      }
    },
  });
};
