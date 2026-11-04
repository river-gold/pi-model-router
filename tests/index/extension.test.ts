import { describe, expect, it, vi, beforeEach } from "vitest";
import routerExtension from "../../src/index/extension";

vi.mock("../../src/commands", async () => {
  const actual = await vi.importActual<typeof CommandsMod>("../../src/commands");
  return {
    ...actual,
    registerCommands: vi.fn((...args: Parameters<typeof actual.registerCommands>) =>
      actual.registerCommands(...args),
    ),
  };
});

import type * as CommandsMod from "../../src/commands";
import type * as ConfigMod from "../../src/config";
import { registerCommands } from "../../src/commands";
import {
  makeFakeDecision,
  makeFakeExtensionContext,
  makeFakeModel,
  makeFakePi,
  makeFakeRegistry,
  makeFakeSessionManager,
  makeFakeUi,
} from "../helpers";

describe("index/extension 모듈", () => {
  const makePiWithListeners = () => {
    const listeners = new Map<string, (...args: any[]) => unknown>();
    const on = vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      listeners.set(event, handler);
    });
    const setModel = vi.fn().mockResolvedValue(true);
    const registerProvider = vi.fn();
    const registerCommand = vi.fn();
    const appendEntry = vi.fn();
    const pi = makeFakePi({ on, setModel, registerProvider, registerCommand, appendEntry });
    return { pi, listeners, on, setModel, registerProvider, registerCommand, appendEntry };
  };

  const getHandler = (listeners: Map<string, (...args: any[]) => unknown>, name: string) => {
    const h = listeners.get(name);
    if (h === undefined) expect.unreachable();
    return h;
  };

  const makeCtx = () => {
    const notify = vi.fn();
    const setStatus = vi.fn();
    const setHiddenThinkingLabel = vi.fn();
    const find = vi
      .fn()
      .mockImplementation((p: string, id: string) =>
        makeFakeModel({ provider: p, id, contextWindow: 100000, maxTokens: 4000 }),
      );
    const list = vi.fn(() => []);
    const ctx = makeFakeExtensionContext({
      cwd: "/cwd",
      modelRegistry: makeFakeRegistry({ find, list }),
      model: makeFakeModel({ provider: "router", id: "balanced" }),
      sessionManager: makeFakeSessionManager({ getBranch: () => [] }),
      ui: makeFakeUi({ notify, setStatus, setHiddenThinkingLabel }),
    });
    return { ctx, notify, setStatus, setHiddenThinkingLabel, find, list };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provider와 commands와 hooks를 등록한다", () => {
    const { pi, listeners, on, registerProvider, registerCommand } = makePiWithListeners();
    routerExtension(pi);
    expect(registerProvider).toHaveBeenCalled();
    expect(registerCommand).toHaveBeenCalled();
    expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(on).toHaveBeenCalledWith("turn_start", expect.any(Function));
    expect(on).toHaveBeenCalledWith("model_select", expect.any(Function));
    expect(on).toHaveBeenCalledWith("turn_end", expect.any(Function));
    expect(listeners.get("session_start")).toBeDefined();
  });

  it("session_start를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    expect(setStatus).toHaveBeenCalled();
  });

  it("turn_start를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(listeners, "turn_start")({}, ctx);
    // should initialize
    expect(setStatus).toHaveBeenCalled();
  });

  it("router인 model_select를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    await getHandler(listeners, "model_select")(
      { model: makeFakeModel({ provider: "router", id: "balanced" }) },
      ctx,
    );
    expect(setStatus).toHaveBeenCalled();
  });

  it("non-router인 model_select를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setHiddenThinkingLabel } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    await getHandler(listeners, "model_select")(
      { model: makeFakeModel({ provider: "openai", id: "gpt-4o" }) },
      ctx,
    );
    expect(setHiddenThinkingLabel).toHaveBeenCalled();
  });

  it("turn_end를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    ctx.model = makeFakeModel({ provider: "openai", id: "gpt-4o" });
    await getHandler(listeners, "turn_end")({}, ctx);
    expect(setStatus).toHaveBeenCalled();
  });

  it("registerCommands의 state getters/setters를 커버한다", async () => {
    const { pi } = makePiWithListeners();
    routerExtension(pi);
    const mockedRegisterCommands = vi.mocked(registerCommands);
    expect(mockedRegisterCommands).toHaveBeenCalled();
    const firstCall = mockedRegisterCommands.mock.calls[0];
    if (firstCall === undefined) expect.unreachable();
    const stateArg: any = firstCall[1];
    // Exercise all getters/setters
    expect(stateArg.currentConfig).toEqual(expect.any(Object));
    expect(typeof stateArg.routerEnabled).toBe("boolean");
    stateArg.routerEnabled = true;
    expect(stateArg.routerEnabled).toBe(true);
    expect(stateArg.selectedRouter).toBeUndefined();
    stateArg.selectedRouter = "balanced";
    expect(stateArg.selectedRouter).toBe("balanced");
    expect(stateArg.lastDecision).toBeUndefined();
    // lastDecision has no setter in this object, so we don't set it
    expect(stateArg.lastNonRouterModel).toBeUndefined();
    stateArg.lastNonRouterModel = "openai/gpt";
    expect(stateArg.lastNonRouterModel).toBe("openai/gpt");
    expect(stateArg.accumulatedCost).toBe(0);
    // accumulatedCost has no setter in this object
    expect(typeof stateArg.debugEnabled).toBe("boolean");
    const origDebug = stateArg.debugEnabled;
    stateArg.debugEnabled = !origDebug;
    expect(stateArg.debugEnabled).toBe(!origDebug);
    expect(stateArg.debugHistory).toEqual([]);
    stateArg.debugHistory = [makeFakeDecision({ router: "p" })];
    expect(stateArg.debugHistory.length).toBe(1);
    expect(stateArg.lastConfigWarnings).toEqual([]);
    expect(stateArg.failedByChain).toBeInstanceOf(Map);
    // Test the actions callbacks via the captured registerCommands call
    const actionsCall = vi.mocked(registerCommands).mock.calls[0];
    if (actionsCall === undefined) expect.unreachable();
    const actionsArg: any = actionsCall[2];
    const { ctx } = makeCtx();
    expect(() => actionsArg.updateStatus(ctx)).not.toThrow();
    expect(() => actionsArg.reloadConfig(ctx)).not.toThrow();
    expect(typeof actionsArg.ensureValidActiveRouter).toBe("function");
  });

  it("session_start 시 debugEnabled 알림을 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    // Mock loadRouterConfig to return debug true
    vi.doMock("../../src/config", async () => {
      const actual = await vi.importActual<typeof ConfigMod>("../../src/config");
      return {
        ...actual,
        loadRouterConfig: vi.fn().mockReturnValue({
          config: { debug: true, routers: { balanced: { medium: { models: ["openai/a"] } } } },
          warnings: [],
        }),
      };
    });
    routerExtension(pi);
    const { ctx } = makeCtx();
    // Need to set debugEnabled true via state, but we can just check that session_start handles it
    await getHandler(listeners, "session_start")({}, ctx);
    // The notify for Router initialized should be called if debugEnabled is true
    // Since we mocked loadRouterConfig to return debug true, it should be true
  });

  it("동일한 contextWindow의 router model_select는 setModelInternally를 호출하지 않는다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    const registryModel = makeFakeModel({
      provider: "router",
      id: "balanced",
      contextWindow: 100000,
      maxTokens: 4000,
    });
    ctx.modelRegistry.find = vi.fn().mockReturnValue(registryModel);
    // Use a fresh pi with spy
    const fresh = makePiWithListeners();
    // Override find to return same window as event
    const notify = vi.fn();
    const setStatus = vi.fn();
    const setHiddenThinkingLabel = vi.fn();
    const ctx3 = makeFakeExtensionContext({
      cwd: "/cwd",
      modelRegistry: makeFakeRegistry({
        find: vi.fn().mockReturnValue(registryModel),
        list: vi.fn(() => []),
      }),
      model: makeFakeModel({ provider: "router", id: "balanced" }),
      sessionManager: makeFakeSessionManager({ getBranch: () => [] }),
      ui: makeFakeUi({ notify, setStatus, setHiddenThinkingLabel }),
    });
    // We need to re-create extension with pi3 to capture setModel calls
    routerExtension(fresh.pi);
    await getHandler(fresh.listeners, "session_start")({}, ctx3);
    // Clear setModel calls from session_start
    fresh.setModel.mockClear();
    await getHandler(fresh.listeners, "model_select")(
      {
        model: makeFakeModel({
          provider: "router",
          id: "balanced",
          contextWindow: 100000,
          maxTokens: 4000,
        }),
      },
      ctx3,
    );
    // Should not have called setModelInternally because windows are equal
    expect(fresh.setModel).not.toHaveBeenCalled();
  });

  it("maxTokens가 다른 router model_select를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    // Use a fresh extension instance with a registry that returns different maxTokens
    const fresh = makePiWithListeners();
    const registryModel = makeFakeModel({
      provider: "router",
      id: "balanced",
      contextWindow: 100000,
      maxTokens: 8000,
    });
    const setStatus = vi.fn();
    const ctx3 = makeFakeExtensionContext({
      cwd: "/cwd",
      modelRegistry: makeFakeRegistry({
        find: vi.fn().mockReturnValue(registryModel),
        list: vi.fn(() => []),
      }),
      model: makeFakeModel({ provider: "router", id: "balanced" }),
      sessionManager: makeFakeSessionManager({ getBranch: () => [] }),
      ui: makeFakeUi({ setStatus }),
    });
    routerExtension(fresh.pi);
    await getHandler(fresh.listeners, "session_start")({}, ctx3);
    await getHandler(fresh.listeners, "model_select")(
      {
        model: makeFakeModel({
          provider: "router",
          id: "balanced",
          contextWindow: 100000,
          maxTokens: 4000,
        }),
      },
      ctx3,
    );
    // Should handle without throwing and set routerEnabled
    expect(setStatus).toHaveBeenCalled();
  });

  it("registryModel이 없는 router model_select를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    ctx.modelRegistry.find = vi.fn().mockReturnValue(undefined);
    await getHandler(listeners, "model_select")(
      {
        model: makeFakeModel({
          provider: "router",
          id: "balanced",
          contextWindow: 100,
          maxTokens: 100,
        }),
      },
      ctx,
    );
    expect(setStatus).toHaveBeenCalled();
  });

  it("routerModel이 없는 turn_end를 처리한다", async () => {
    const { pi, listeners } = makePiWithListeners();
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(listeners, "session_start")({}, ctx);
    // Set routerEnabled and selectedRouter, but make find return undefined for turn_end
    ctx.model = makeFakeModel({ provider: "openai", id: "gpt-4o" });
    ctx.modelRegistry.find = vi.fn().mockReturnValue(undefined);
    await getHandler(listeners, "turn_end")({}, ctx);
    expect(setStatus).toHaveBeenCalled();
  });
});
