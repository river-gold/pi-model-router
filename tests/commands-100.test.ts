/* oxlint-disable */
import { describe, it, expect, vi } from "vitest";
import { registerCommands } from "../src/commands";
import type { RouterConfig } from "../src/types";

const makePi = () => {
  let cmd: any = null;
  return {
    registerCommand: (n: string, c: any) => {
      if (n === "router") cmd = c;
    },
    get: () => cmd,
  };
};

const baseConfig = (over: Partial<RouterConfig> = {}): RouterConfig => ({
  profiles: { balanced: { high: { models: ["openai/gpt"] } } },
  historySize: 0,
  ...over,
});

const buildState = (over: Record<string, unknown> = {}) => ({
  currentConfig: baseConfig(),
  routerEnabled: true,
  selectedProfile: "balanced" as string | undefined,
  lastDecision: {
    profile: "balanced",
    tier: "high",
    targetProvider: "openai",
    targetModelId: "gpt",
    targetLabel: "openai/gpt",
    reasoning: "r",
    thinking: "high",
    timestamp: Date.now(),
  } as any,
  lastNonRouterModel: "openai/gpt",
  accumulatedCost: 0.01,
  debugEnabled: false,
  debugHistory: [
    {
      profile: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt",
      targetLabel: "openai/gpt",
      reasoning: "r",
      thinking: "high",
      timestamp: Date.now(),
    } as any,
  ],
  lastConfigWarnings: [] as string[],
  failedByChain: new Map<string, Set<string>>(),
  ...over,
});

const buildCtx = () => ({ ui: { notify: vi.fn(), setStatus: vi.fn() } }) as any;
const buildActions = () => ({
  persistState: vi.fn(),
  updateStatus: vi.fn(),
  reloadConfig: vi.fn(),
  ensureValidActiveRouterProfile: vi.fn().mockResolvedValue(undefined),
});

describe("commands 100% branches", () => {
  it("getSubcommandCompletions fallback null for non-matching prefix", () => {
    const pi = makePi();
    registerCommands(pi as any, buildState() as any, buildActions() as any);
    const c = pi.get();
    // single-part without trailing space goes through getSubcommandCompletions directly
    expect(c.getArgumentCompletions("zzz")).toBeNull();
    expect(c.getArgumentCompletions("nope")).toBeNull();
  });

  it("status with routerEnabled off covers cond-expr[1] at line 57", async () => {
    const pi = makePi();
    const state = buildState({ routerEnabled: false });
    const actions = buildActions();
    registerCommands(pi as any, state as any, actions as any);
    const ctx = buildCtx();
    await pi.get().handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Router enabled: off"), "info");
  });

  it("status with selectedProfile undefined covers ?? \"none\" at line 58", async () => {
    const pi = makePi();
    const state = buildState({ selectedProfile: undefined });
    const actions = buildActions();
    registerCommands(pi as any, state as any, actions as any);
    const ctx = buildCtx();
    await pi.get().handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Selected profile: none"), "info");
  });

  it("status with historySize defined covers ?? 0 cond-expr[0] at line 62", async () => {
    const pi = makePi();
    const state = buildState({ currentConfig: baseConfig({ historySize: 7 }) });
    const actions = buildActions();
    registerCommands(pi as any, state as any, actions as any);
    const ctx = buildCtx();
    await pi.get().handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("History size: 7"), "info");
  });

  it("status with lastDecision.thinking undefined covers ?? \"auto\" at line 68", async () => {
    const pi = makePi();
    const state = buildState({
      lastDecision: {
        profile: "balanced",
        tier: "high",
        targetProvider: "openai",
        targetModelId: "gpt",
        targetLabel: "openai/gpt",
        reasoning: "r",
        thinking: undefined,
        timestamp: Date.now(),
      } as any,
    });
    const actions = buildActions();
    registerCommands(pi as any, state as any, actions as any);
    const ctx = buildCtx();
    await pi.get().handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("(auto)"), "info");
  });

  it("debug completions fallback null when prefix matches none (line 181)", () => {
    const pi = makePi();
    registerCommands(pi as any, buildState() as any, buildActions() as any);
    const c = pi.get();
    // debug with trailing space already gives [""], then filter "zzz" matches nothing
    expect(c.getArgumentCompletions("debug zzz")).toBeNull();
    expect(c.getArgumentCompletions("debug q")).toBeNull();
  });

  it("handler with undefined args covers ?? [] at line 188 and falls through to status", async () => {
    const pi = makePi();
    const state = buildState();
    const actions = buildActions();
    registerCommands(pi as any, state as any, actions as any);
    const ctx = buildCtx();
    await pi.get().handler(undefined as any, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Model Router Status:"), "info");
  });

  it("handler with empty string and whitespace args also covers status fallback", async () => {
    const pi = makePi();
    const state = buildState();
    const actions = buildActions();
    registerCommands(pi as any, state as any, actions as any);
    const ctx = buildCtx();
    await pi.get().handler("   ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Model Router Status:"), "info");
  });

  it("getArgumentCompletions with trailing single-part known prefix still works after dead-code removal", () => {
    const pi = makePi();
    registerCommands(pi as any, buildState() as any, buildActions() as any);
    const c = pi.get();
    // "status " has trailing space, should still return null (not debug)
    expect(c.getArgumentCompletions("status ")).toBeNull();
    // "debug " should return all debug items
    const dbg = c.getArgumentCompletions("debug ");
    expect(dbg).not.toBeNull();
    expect(dbg!.map((x: any) => x.label)).toEqual(expect.arrayContaining(["on", "off"]));
  });

  it("getArgumentCompletions with leading spaces trimmed", () => {
    const pi = makePi();
    registerCommands(pi as any, buildState() as any, buildActions() as any);
    const c = pi.get();
    expect(c.getArgumentCompletions("  st")).not.toBeNull();
    expect(c.getArgumentCompletions("  zzz")).toBeNull();
  });
});
