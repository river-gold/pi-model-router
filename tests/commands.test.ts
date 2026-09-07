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
const ctx = () => ({ ui: { notify: vi.fn(), setStatus: vi.fn() } }) as any;
const acts = () => ({
  persistState: vi.fn(),
  updateStatus: vi.fn(),
  reloadConfig: vi.fn(),
  ensureValidActiveRouterProfile: vi.fn().mockResolvedValue(undefined),
});
const cfg = (o: Partial<RouterConfig> = {}): RouterConfig =>
  ({
    profiles: {
      balanced: { high: { models: ["openai/gpt"] } },
      cheap: { low: { models: ["openai/gpt-mini"] } },
    },
    ...o,
  }) as any;
const decis = (over: any = {}) => ({
  profile: "balanced",
  tier: "high",
  targetProvider: "openai",
  targetModelId: "gpt",
  targetLabel: "openai/gpt",
  reasoning: "r",
  thinking: "high",
  timestamp: Date.now(),
  ...over,
});
const state = (over: any = {}) => ({
  currentConfig: cfg(),
  routerEnabled: true,
  selectedProfile: "balanced",
  lastDecision: decis(),
  lastNonRouterModel: "openai/gpt",
  accumulatedCost: 0.01,
  debugEnabled: false,
  debugHistory: [decis()],
  lastConfigWarnings: [] as string[],
  failedByChain: new Map<string, Set<string>>(),
  ...over,
});

describe("commands 명령어는", () => {
  it("status는 인자 없이 상태를 표시한다", async () => {
    const pi = makePi();
    const s = state({ debugEnabled: true });
    const a = acts();
    registerCommands(pi as any, s as any, a as any);
    const c = ctx();
    await pi.get().handler("status", c);
    expect(c.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status:"),
      "info",
    );
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Debug: on"), "info");
    expect(a.updateStatus).toHaveBeenCalled();
  });
  it("status는 인자가 있으면 에러를 표시한다", async () => {
    const pi = makePi();
    registerCommands(pi as any, state() as any, acts() as any);
    const c = ctx();
    await pi.get().handler("status extra", c);
    expect(c.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage: /router status"),
      "error",
    );
  });
  it("status는 lastDecision과 auto thinking을 표시한다", async () => {
    const pi = makePi();
    const s = state({ lastDecision: decis({ thinking: undefined }) });
    registerCommands(pi as any, s as any, acts() as any);
    const c = ctx();
    await pi.get().handler("status", c);
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("(auto)"), "info");
  });
  it("status는 lastDecision이 없고 router가 비활성화된 경우를 표시한다", async () => {
    const pi = makePi();
    const s = state({
      lastDecision: undefined,
      routerEnabled: false,
      selectedProfile: undefined,
      currentConfig: cfg({ historySize: 5 }),
    });
    registerCommands(pi as any, s as any, acts() as any);
    const c = ctx();
    await pi.get().handler("status", c);
    const msg = c.ui.notify.mock.calls[0][0] as string;
    expect(msg).toContain("Router enabled: off");
    expect(msg).toContain("Selected profile: none");
    expect(msg).toContain("History size: 5");
    expect(msg).not.toContain("Last routed tier");
  });
  it("status는 historySize가 undefined이면 기본값 0을 표시한다", async () => {
    const pi = makePi();
    const s = state({ currentConfig: cfg() });
    delete (s.currentConfig as any).historySize;
    registerCommands(pi as any, s as any, acts() as any);
    const c = ctx();
    await pi.get().handler("status", c);
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("History size: 0"), "info");
  });
  it("status는 failures와 warnings를 표시한다", async () => {
    const pi = makePi();
    const s = state({
      failedByChain: new Map([
        ["chain:a", new Set(["openai/gpt"])],
        ["empty", new Set()],
      ]),
      lastConfigWarnings: ["w1"],
    });
    registerCommands(pi as any, s as any, acts() as any);
    const c = ctx();
    await pi.get().handler("status", c);
    const msg = c.ui.notify.mock.calls[0][0] as string;
    expect(msg).toContain("Session failures");
    expect(msg).toContain("chain:a");
    expect(msg).toContain("w1");
  });
  it("status는 failures가 비어 있으면 none을 표시한다", async () => {
    const pi = makePi();
    registerCommands(pi as any, state({ failedByChain: new Map() }) as any, acts() as any);
    const c = ctx();
    await pi.get().handler("status", c);
    expect(c.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Session failures: none"),
      "info",
    );
  });
  it("debug는 on/off/toggle/clear/show/empty/invalid 동작을 처리한다", async () => {
    const pi = makePi();
    const s = state({ debugEnabled: false, debugHistory: [decis()] });
    const a = acts();
    registerCommands(pi as any, s as any, a as any);
    const c = ctx();
    await pi.get().handler("debug on", c);
    expect(s.debugEnabled).toBe(true);
    await pi.get().handler("debug off", c);
    expect(s.debugEnabled).toBe(false);
    await pi.get().handler("debug toggle", c);
    expect(s.debugEnabled).toBe(true);
    await pi.get().handler("debug", c);
    expect(s.debugEnabled).toBe(false);
    await pi.get().handler("debug show", c);
    expect(c.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Recent Routing Decisions"),
      "info",
    );
    s.debugHistory = [];
    await pi.get().handler("debug show", c);
    expect(c.ui.notify).toHaveBeenCalledWith("No recent routing decisions.", "info");
    await pi.get().handler("debug clear", c);
    expect(s.debugHistory.length).toBe(0);
    const c2 = ctx();
    await pi.get().handler("debug invalid", c2);
    expect(c2.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
    const c3 = ctx();
    await pi.get().handler("debug on extra", c3);
    expect(c3.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("reload는 성공과 인자 오류를 처리한다", async () => {
    const pi = makePi();
    const s = state();
    const a = acts();
    registerCommands(pi as any, s as any, a as any);
    const c = ctx();
    await pi.get().handler("reload", c);
    expect(a.reloadConfig).toHaveBeenCalledWith(c, { preserveDebug: true });
    expect(a.ensureValidActiveRouterProfile).toHaveBeenCalled();
    const c2 = ctx();
    await pi.get().handler("reload extra", c2);
    expect(c2.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("reset-failures는 초기화와 오류를 처리한다", async () => {
    const pi = makePi();
    const s = state({ failedByChain: new Map([["a", new Set(["x"])]]) });
    const a = acts();
    registerCommands(pi as any, s as any, a as any);
    const c = ctx();
    await pi.get().handler("reset-failures", c);
    expect(s.failedByChain.size).toBe(0);
    const c2 = ctx();
    await pi.get().handler("reset-failures extra", c2);
    expect(c2.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("help와 ?는 도움말과 인자 오류를 처리한다", async () => {
    const pi = makePi();
    registerCommands(pi as any, state() as any, acts() as any);
    const c = ctx();
    await pi.get().handler("help", c);
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Router Subcommands"), "info");
    const c2 = ctx();
    await pi.get().handler("?", c2);
    expect(c2.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Router Subcommands"),
      "info",
    );
    const c3 = ctx();
    await pi.get().handler("help extra", c3);
    expect(c3.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("unknown 명령어와 빈 입력은 fallback으로 처리한다", async () => {
    const pi = makePi();
    registerCommands(pi as any, state() as any, acts() as any);
    const c = ctx();
    await pi.get().handler("unknowncmd", c);
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unknown"), "error");
    const c2 = ctx();
    await pi.get().handler("", c2);
    expect(c2.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status"),
      "info",
    );
    const c3 = ctx();
    await pi.get().handler(undefined as any, c3);
    expect(c3.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status"),
      "info",
    );
    const c4 = ctx();
    await pi.get().handler("   ", c4);
    expect(c4.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status"),
      "info",
    );
  });
  it("getArgumentCompletions는 empty/partial/debug/unknown 입력을 처리한다", () => {
    const pi = makePi();
    registerCommands(pi as any, state() as any, acts() as any);
    const g = pi.get().getArgumentCompletions;
    expect(g("")).not.toBeNull();
    expect(g("").map((x: any) => x.value)).toContain("status");
    expect(g("st")!.map((x: any) => x.value)).toContain("status");
    expect(g("zzz")).toBeNull();
    expect(g("  st")!.map((x: any) => x.value)).toContain("status");
    expect(g("debug")).not.toBeNull();
    expect(g("debug")!.map((x: any) => x.value)).toContain("debug on");
    expect(g("debug ")!.map((x: any) => x.value)).toContain("debug on");
    expect(g("debug o")!.map((x: any) => x.value)).toContain("debug on");
    expect(g("debug zzz")).toBeNull();
    expect(g("status ")).toBeNull();
    expect(g("unknown ")).toBeNull();
    expect(g("   ")).not.toBeNull();
  });
});
