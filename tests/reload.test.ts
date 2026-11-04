import { describe, expect, it, vi } from "vitest";
import type * as ConfigModule from "../src/config";
import { createRouterState } from "../src/state";
import { createReloadConfig } from "../src/index/reload";
import { makeFakeExtensionContext, makeFakeModel, makeFakePi, makeFakeRegistry } from "./helpers";

const loadRouterConfig = vi.fn();
vi.mock("../src/config", async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    loadRouterConfig: (...args: unknown[]) => loadRouterConfig(...args),
  };
});

const physical = (id: string) => makeFakeModel({ provider: "p", id });
const ctxWithModels = () =>
  makeFakeExtensionContext({
    modelRegistry: makeFakeRegistry({
      find: (provider: string, id: string) => (provider === "p" ? physical(id) : undefined),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "k" }),
    }),
  });

describe("createReloadConfig", () => {
  it("설정을 읽어 가상 모델을 등록하고 경고를 알린다", () => {
    const pi = makeFakePi();
    const state = createRouterState();
    const reload = createReloadConfig(pi, state);
    loadRouterConfig.mockReturnValue({
      config: { debug: true, routers: { a: { medium: { models: ["p/x"] } } } },
      warnings: ["warn"],
    });
    const ctx = ctxWithModels();
    reload(ctx);
    expect(pi.registerVirtualModel).toHaveBeenCalledTimes(1);
    expect(state.debugEnabled).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("warn"), "warning");
  });

  it("registry 없이도 등록하고 preserveDebug를 존중한다", () => {
    const pi = makeFakePi();
    const state = createRouterState();
    state.currentModelRegistry = ctxWithModels().modelRegistry;
    state.debugEnabled = true;
    const reload = createReloadConfig(pi, state);
    loadRouterConfig.mockReturnValue({
      config: { debug: false, routers: { a: { medium: { models: ["p/x"] } } } },
      warnings: [],
    });
    reload(undefined, { preserveDebug: true });
    expect(state.debugEnabled).toBe(true);
    expect(pi.registerVirtualModel).toHaveBeenCalledTimes(1);
  });

  it("debug가 켜져 있으면 결정을 히스토리에 기록한다", async () => {
    const pi = makeFakePi();
    const state = createRouterState();
    state.debugEnabled = true;
    const reload = createReloadConfig(pi, state);
    loadRouterConfig.mockReturnValue({
      config: { debug: true, routers: { a: { medium: { models: ["p/x"] } } } },
      warnings: [],
    });
    reload(ctxWithModels());
    const definition = (pi.registerVirtualModel as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      route: (request: unknown, ctx: unknown) => Promise<unknown>;
    };
    await definition.route(
      { model: physical("router"), thinkingLevel: "medium", reason: "user", messages: [] },
      ctxWithModels(),
    );
    expect(state.debugHistory).toHaveLength(1);
    expect(state.lastDecision?.targetModelId).toBe("x");
  });

  it("debug가 꺼져 있으면 결정만 기록한다", async () => {
    const pi = makeFakePi();
    const state = createRouterState();
    const reload = createReloadConfig(pi, state);
    loadRouterConfig.mockReturnValue({
      config: { routers: { a: { medium: { models: ["p/x"] } } } },
      warnings: [],
    });
    reload(ctxWithModels());
    const definition = (pi.registerVirtualModel as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      route: (request: unknown, ctx: unknown) => Promise<unknown>;
    };
    await definition.route(
      { model: physical("router"), thinkingLevel: "medium", reason: "user", messages: [] },
      ctxWithModels(),
    );
    expect(state.lastDecision?.targetModelId).toBe("x");
    expect(state.debugHistory).toHaveLength(0);
  });
});
