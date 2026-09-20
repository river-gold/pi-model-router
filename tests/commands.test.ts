import { describe, it, expect, vi } from "vitest";
import { registerCommands } from "../src/commands";
import type { RouterConfig } from "../src/types";
import type { RoutingDecision } from "../src/types";
import { makeFakeDecision, makeFakeExtensionContext, makeFakePi, makeFakeUi } from "./helpers";

const makePiAndCommand = (
  s: Parameters<typeof registerCommands>[1],
  a: Parameters<typeof registerCommands>[2],
) => {
  const commands = new Map<string, unknown>();
  const registerCommand = vi.fn((name: string, cmd: unknown) => {
    commands.set(name, cmd);
  });
  const pi = makeFakePi({ registerCommand });
  registerCommands(pi, s, a);
  const cmd = commands.get("router");
  if (typeof cmd !== "object" || cmd === null) expect.unreachable();
  if (!("handler" in cmd) || typeof cmd.handler !== "function") expect.unreachable();
  const handler = cmd.handler;
  const getCompletions =
    "getArgumentCompletions" in cmd && typeof cmd.getArgumentCompletions === "function"
      ? cmd.getArgumentCompletions
      : undefined;
  if (getCompletions === undefined) expect.unreachable();
  return { pi, handler, getCompletions };
};
const makeCtx = () => {
  const notify = vi.fn();
  const setStatus = vi.fn();
  const ctx = makeFakeExtensionContext({ ui: makeFakeUi({ notify, setStatus }) });
  return { ctx, notify, setStatus };
};
const makeActs = () => {
  const persistState = vi.fn();
  const updateStatus = vi.fn();
  const reloadConfig = vi.fn();
  const ensureValidActiveRouter = vi.fn().mockResolvedValue(undefined);
  const actions = { persistState, updateStatus, reloadConfig, ensureValidActiveRouter };
  return { actions, persistState, updateStatus, reloadConfig, ensureValidActiveRouter };
};
const makeCfg = (over: Partial<RouterConfig> = {}): RouterConfig => ({
  routers: {
    balanced: { high: { models: ["openai/gpt"] } },
    cheap: { low: { models: ["openai/gpt-mini"] } },
  },
  ...over,
});
const makeDecis = (over: Partial<RoutingDecision> = {}): RoutingDecision =>
  makeFakeDecision({
    router: "balanced",
    tier: "high",
    targetProvider: "openai",
    targetModelId: "gpt",
    targetLabel: "openai/gpt",
    reasoning: "r",
    effort: "high",
    ...over,
  });
const makeState = (over: Partial<Parameters<typeof registerCommands>[1]> = {}) =>
  Object.assign(
    {
      currentConfig: makeCfg(),
      routerEnabled: true,
      selectedRouter: "balanced" as string | undefined,
      lastDecision: makeDecis() as RoutingDecision | undefined,
      lastNonRouterModel: "openai/gpt" as string | undefined,
      accumulatedCost: 0.01,
      debugEnabled: false,
      debugHistory: [makeDecis()],
      lastConfigWarnings: [] as string[],
      failedByChain: new Map<string, Set<string>>(),
    },
    over,
  );

const firstNotifyArg = (notify: ReturnType<typeof vi.fn>): string => {
  const first = notify.mock.calls[0];
  if (first === undefined) expect.unreachable();
  const msg = first[0];
  if (typeof msg !== "string") expect.unreachable();
  return msg;
};

describe("commands 명령어는", () => {
  it("status는 인자 없이 상태를 표시한다", async () => {
    const s = makeState({ debugEnabled: true });
    const { actions, updateStatus } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Model Router Status:"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Debug: on"), "info");
    expect(updateStatus).toHaveBeenCalled();
  });
  it("status는 인자가 있으면 에러를 표시한다", async () => {
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(makeState(), actions);
    const { ctx, notify } = makeCtx();
    await handler("status extra", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /router status"), "error");
  });
  it("status는 lastDecision과 auto thinking을 표시한다", async () => {
    const s = makeState({ lastDecision: makeDecis({ effort: undefined }) });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("(auto)"), "info");
  });
  it("status는 lastDecision이 없고 router가 비활성화된 경우를 표시한다", async () => {
    const s = makeState({
      lastDecision: undefined,
      routerEnabled: false,
      selectedRouter: undefined,
      currentConfig: makeCfg({ historySize: 5 }),
    });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    const msg = firstNotifyArg(notify);
    expect(msg).toContain("Router enabled: off");
    expect(msg).toContain("Selected router: none");
    expect(msg).toContain("History size: 5");
    expect(msg).not.toContain("Last routed tier");
  });
  it("status는 historySize가 undefined이면 기본값 0을 표시한다", async () => {
    const cfg = makeCfg();
    delete cfg.historySize;
    const s = makeState({ currentConfig: cfg });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("History size: 0"), "info");
  });
  it("status는 routeEveryTurn이 켜져 있으면 on을 표시한다", async () => {
    const s = makeState({ currentConfig: makeCfg({ routeEveryTurn: true }) });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Route every turn: on"), "info");
  });
  it("status는 failures와 warnings를 표시한다", async () => {
    const s = makeState({
      failedByChain: new Map([
        ["chain:a", new Set(["openai/gpt"])],
        ["empty", new Set()],
      ]),
      lastConfigWarnings: ["w1"],
    });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    const msg = firstNotifyArg(notify);
    expect(msg).toContain("Session failures");
    expect(msg).toContain("chain:a");
    expect(msg).toContain("w1");
  });
  it("status는 failures가 비어 있으면 none을 표시한다", async () => {
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(makeState({ failedByChain: new Map() }), actions);
    const { ctx, notify } = makeCtx();
    await handler("status", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Session failures: none"), "info");
  });
  it("debug는 on/off/toggle/clear/show/empty/invalid 동작을 처리한다", async () => {
    const s = makeState({ debugEnabled: false, debugHistory: [makeDecis()] });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx, notify } = makeCtx();
    await handler("debug on", ctx);
    expect(s.debugEnabled).toBe(true);
    await handler("debug off", ctx);
    expect(s.debugEnabled).toBe(false);
    await handler("debug toggle", ctx);
    expect(s.debugEnabled).toBe(true);
    await handler("debug", ctx);
    expect(s.debugEnabled).toBe(false);
    await handler("debug show", ctx);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Recent Routing Decisions"),
      "info",
    );
    s.debugHistory = [];
    await handler("debug show", ctx);
    expect(notify).toHaveBeenCalledWith("No recent routing decisions.", "info");
    await handler("debug clear", ctx);
    expect(s.debugHistory.length).toBe(0);
    const second = makeCtx();
    await handler("debug invalid", second.ctx);
    expect(second.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
    const third = makeCtx();
    await handler("debug on extra", third.ctx);
    expect(third.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("reload는 성공과 인자 오류를 처리한다", async () => {
    const s = makeState();
    const { actions, reloadConfig, ensureValidActiveRouter } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx } = makeCtx();
    await handler("reload", ctx);
    expect(reloadConfig).toHaveBeenCalledWith(ctx, { preserveDebug: true });
    expect(ensureValidActiveRouter).toHaveBeenCalled();
    const second = makeCtx();
    await handler("reload extra", second.ctx);
    expect(second.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("reset-failures는 초기화와 오류를 처리한다", async () => {
    const s = makeState({ failedByChain: new Map([["a", new Set(["x"])]]) });
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(s, actions);
    const { ctx } = makeCtx();
    await handler("reset-failures", ctx);
    expect(s.failedByChain.size).toBe(0);
    const second = makeCtx();
    await handler("reset-failures extra", second.ctx);
    expect(second.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("help와 ?는 도움말과 인자 오류를 처리한다", async () => {
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(makeState(), actions);
    const { ctx, notify } = makeCtx();
    await handler("help", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Router Subcommands"), "info");
    const second = makeCtx();
    await handler("?", second.ctx);
    expect(second.notify).toHaveBeenCalledWith(
      expect.stringContaining("Router Subcommands"),
      "info",
    );
    const third = makeCtx();
    await handler("help extra", third.ctx);
    expect(third.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });
  it("unknown 명령어와 빈 입력은 fallback으로 처리한다", async () => {
    const { actions } = makeActs();
    const { handler } = makePiAndCommand(makeState(), actions);
    const { ctx, notify } = makeCtx();
    await handler("unknowncmd", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Unknown"), "error");
    const second = makeCtx();
    await handler("", second.ctx);
    expect(second.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status"),
      "info",
    );
    const third = makeCtx();
    await handler(undefined, third.ctx);
    expect(third.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status"),
      "info",
    );
    const fourth = makeCtx();
    await handler("   ", fourth.ctx);
    expect(fourth.notify).toHaveBeenCalledWith(
      expect.stringContaining("Model Router Status"),
      "info",
    );
  });
  it("getArgumentCompletions는 empty/partial/debug/unknown 입력을 처리한다", () => {
    const { actions } = makeActs();
    const { getCompletions: g } = makePiAndCommand(makeState(), actions);
    const empty = g("");
    if (empty === null) expect.unreachable();
    expect(empty).not.toBeNull();
    expect(empty.map((x) => x.value)).toContain("status");
    const st = g("st");
    if (st === null) expect.unreachable();
    expect(st.map((x) => x.value)).toContain("status");
    expect(g("zzz")).toBeNull();
    const padded = g("  st");
    if (padded === null) expect.unreachable();
    expect(padded.map((x) => x.value)).toContain("status");
    const debug = g("debug");
    if (debug === null) expect.unreachable();
    expect(debug).not.toBeNull();
    const debugItems = g("debug");
    if (debugItems === null) expect.unreachable();
    expect(debugItems.map((x) => x.value)).toContain("debug on");
    const debugSpace = g("debug ");
    if (debugSpace === null) expect.unreachable();
    expect(debugSpace.map((x) => x.value)).toContain("debug on");
    const debugO = g("debug o");
    if (debugO === null) expect.unreachable();
    expect(debugO.map((x) => x.value)).toContain("debug on");
    expect(g("debug zzz")).toBeNull();
    expect(g("status ")).toBeNull();
    expect(g("unknown ")).toBeNull();
    const spaces = g("   ");
    if (spaces === null) expect.unreachable();
    expect(spaces).not.toBeNull();
  });
});
