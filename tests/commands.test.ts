import { describe, expect, it, vi } from "vitest";
import type { RegisteredCommand } from "@earendil-works/pi-coding-agent";
import {
  buildDebugShowMessage,
  formatStatusLines,
  parseArgs,
  parsePrefix,
  registerCommands,
  resolveActiveRouter,
} from "../src/commands";
import type { RouterStateView } from "../src/commands";
import type { RouterConfig } from "../src/types";
import { makeFakeDecision, makeFakeExtensionContext, makeFakePi } from "./helpers";

const config: RouterConfig = { routers: { balanced: { medium: { models: ["p/a"] } } } };

const makeState = (over: Partial<RouterStateView> = {}): RouterStateView => ({
  currentConfig: config,
  lastDecision: undefined,
  debugEnabled: false,
  debugHistory: [],
  lastConfigWarnings: [],
  ...over,
});

const setup = (state: RouterStateView = makeState()) => {
  const pi = makeFakePi();
  const actions = { reloadConfig: vi.fn() };
  registerCommands(pi, state, actions);
  const command = (pi.registerCommand as ReturnType<typeof vi.fn>).mock
    .calls[0]![1] as RegisteredCommand;
  const ctx = makeFakeExtensionContext();
  return { pi, actions, command, ctx, state };
};

const notifyText = (ctx: ReturnType<typeof makeFakeExtensionContext>, index = 0): string =>
  (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[index]![0] as string;

describe("/router 명령", () => {
  it("status는 현재 라우터 상태를 알린다", async () => {
    const { command, ctx } = setup();
    await command.handler("status", ctx);
    expect(notifyText(ctx)).toContain("Model Router Status:");
  });

  it("status는 인자가 있으면 사용법을 알린다", async () => {
    const { command, ctx } = setup();
    await command.handler("status extra", ctx);
    expect(notifyText(ctx)).toContain("Usage: /router status");
  });

  it("인자 없는 호출은 status로 처리한다", async () => {
    const { command, ctx } = setup();
    await command.handler("", ctx);
    expect(notifyText(ctx)).toContain("Model Router Status:");
  });

  it("debug on/off/toggle/clear/show를 처리한다", async () => {
    const { command, ctx, state } = setup();
    await command.handler("debug on", ctx);
    expect(state.debugEnabled).toBe(true);
    await command.handler("debug off", ctx);
    expect(state.debugEnabled).toBe(false);
    await command.handler("debug", ctx);
    expect(state.debugEnabled).toBe(true);
    await command.handler("debug toggle", ctx);
    expect(state.debugEnabled).toBe(false);
    state.debugHistory = [makeFakeDecision()];
    await command.handler("debug show", ctx);
    expect(notifyText(ctx, 4)).toContain("Recent Routing Decisions:");
    await command.handler("debug clear", ctx);
    expect(state.debugHistory).toEqual([]);
  });

  it("debug 인자가 너무 많거나 잘못되면 사용법을 알린다", async () => {
    const { command, ctx } = setup();
    await command.handler("debug on extra", ctx);
    expect(notifyText(ctx)).toContain("Usage: /router debug");
    await command.handler("debug bogus", ctx);
    expect(notifyText(ctx, 1)).toContain("Usage: /router debug");
  });

  it("reload는 설정을 다시 읽는다", async () => {
    const { command, ctx, actions } = setup();
    await command.handler("reload", ctx);
    expect(actions.reloadConfig).toHaveBeenCalled();
    expect(notifyText(ctx)).toContain("Router config reloaded");
  });

  it("reload 인자가 있으면 사용법을 알린다", async () => {
    const { command, ctx } = setup();
    await command.handler("reload now", ctx);
    expect(notifyText(ctx)).toContain("Usage: /router reload");
  });

  it("help를 알린다", async () => {
    const { command, ctx } = setup();
    await command.handler("help", ctx);
    expect(notifyText(ctx)).toContain("Router Subcommands:");
    await command.handler("help extra", ctx);
    expect(notifyText(ctx, 1)).toContain("Usage: /router help");
  });

  it("알 수 없는 하위 명령을 알린다", async () => {
    const { command, ctx } = setup();
    await command.handler("bogus", ctx);
    expect(notifyText(ctx)).toContain("Unknown router subcommand");
  });

  it("인자 완성을 제공한다", () => {
    const { command } = setup();
    expect(command.getArgumentCompletions?.("st")).toEqual([
      { value: "status", label: "status", description: expect.any(String) },
    ]);
    expect(command.getArgumentCompletions?.("debug ")).toEqual(
      expect.arrayContaining([{ value: "debug on", label: "on", description: expect.any(String) }]),
    );
    expect(command.getArgumentCompletions?.("bogus ")).toBeNull();
    expect(command.getArgumentCompletions?.("zzz")).toBeNull();
    expect(command.getArgumentCompletions?.("status x")).toBeNull();
    expect(command.getArgumentCompletions?.("debug z")).toBeNull();
    expect(command.getArgumentCompletions?.("")).toHaveLength(4);
    expect(command.getArgumentCompletions?.("debug")).toHaveLength(5);
  });
});

describe("status 포맷", () => {
  it("마지막 결정과 경고를 포함한다", () => {
    const state = makeState({
      lastDecision: makeFakeDecision({ effort: "high" }),
      lastConfigWarnings: ["warn"],
      debugEnabled: true,
    });
    const lines = formatStatusLines(state, { enabled: true, router: "balanced" });
    expect(lines.join("\n")).toContain("Last model: openai/gpt (high)");
    expect(lines.join("\n")).toContain("⚠️ Configuration Warnings:");
  });

  it("활성 라우터를 모델에서 판별한다", () => {
    expect(resolveActiveRouter(config, { provider: "router", id: "balanced" })).toEqual({
      enabled: true,
      router: "balanced",
    });
    expect(resolveActiveRouter(config, { provider: "openai", id: "gpt" })).toEqual({
      enabled: false,
      router: undefined,
    });
    expect(resolveActiveRouter(config, undefined)).toEqual({ enabled: false, router: undefined });
  });

  it("debug show는 빈 기록을 처리한다", () => {
    expect(buildDebugShowMessage([])).toBe("No recent routing decisions.");
  });

  it("비활성 상태와 effort 없음도 표시한다", () => {
    const state = makeState({ lastDecision: makeFakeDecision({ effort: undefined }) });
    const text = formatStatusLines(state, { enabled: false, router: undefined }).join("\n");
    expect(text).toContain("Router enabled: off");
    expect(text).toContain("(auto)");
  });

  it("parseArgs와 parsePrefix를 처리한다", () => {
    expect(parseArgs(undefined)).toEqual({ subcommand: undefined, subArgs: [] });
    expect(parseArgs("a b")).toEqual({ subcommand: "a", subArgs: ["b"] });
    expect(parsePrefix("")).toEqual({ subcommand: "", subArgs: [], hasTrailingSpace: false });
    expect(parsePrefix("debug ")).toEqual({
      subcommand: "debug",
      subArgs: [""],
      hasTrailingSpace: true,
    });
  });
});
