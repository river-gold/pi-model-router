import { describe, expect, it, vi, beforeEach } from "vitest";
import routerExtension from "../../src/index/extension";

vi.mock("../../src/commands", async () => {
  const actual = (await vi.importActual("../../src/commands")) as any;
  return {
    ...actual,
    registerCommands: vi.fn((...args: any[]) => actual.registerCommands(...args)),
  };
});

import { registerCommands } from "../../src/commands";

describe("index/extension", () => {
  const makePi = () => {
    const listeners: Record<string, Function> = {};
    return {
      pi: {
        registerProvider: vi.fn(),
        registerCommand: vi.fn(),
        setModel: vi.fn().mockResolvedValue(true),
        appendEntry: vi.fn(),
        on: vi.fn((e: string, h: Function) => {
          listeners[e] = h;
        }),
        getThinkingLevel: vi.fn().mockReturnValue("off"),
      } as any,
      listeners,
    };
  };

  const makeCtx = (over: any = {}) => ({
    cwd: "/cwd",
    modelRegistry: {
      find: vi.fn(
        (p: string, id: string) =>
          ({ provider: p, id, contextWindow: 100000, maxTokens: 4000 }) as any,
      ),
      list: vi.fn(() => []),
    },
    model: { provider: "router", id: "balanced" },
    sessionManager: { getBranch: () => [] },
    ui: {
      setStatus: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      notify: vi.fn(),
      theme: { fg: (_: string, t: string) => t },
    },
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers provider and commands and hooks", () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    expect(pi.registerProvider).toHaveBeenCalled();
    expect(pi.registerCommand).toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("turn_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("model_select", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
    expect(listeners["session_start"]).toBeDefined();
  });

  it("handles session_start", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("handles turn_start", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["turn_start"]({}, ctx);
    // should initialize
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("handles model_select router", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    await listeners["model_select"]({ model: { provider: "router", id: "balanced" } }, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("handles model_select non-router", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    await listeners["model_select"]({ model: { provider: "openai", id: "gpt-4o" } }, ctx);
    expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
  });

  it("handles turn_end", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    ctx.model = { provider: "openai", id: "gpt-4o" } as any;
    await listeners["turn_end"]({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("covers registerCommands state getters/setters", async () => {
    const { pi } = makePi();
    routerExtension(pi);
    const mockedRegisterCommands = vi.mocked(registerCommands);
    expect(mockedRegisterCommands).toHaveBeenCalled();
    const stateArg = mockedRegisterCommands.mock.calls[0][1] as any;
    // Exercise all getters/setters
    expect(stateArg.currentConfig).toEqual(expect.any(Object));
    expect(typeof stateArg.routerEnabled).toBe("boolean");
    stateArg.routerEnabled = true;
    expect(stateArg.routerEnabled).toBe(true);
    expect(stateArg.selectedProfile).toBeUndefined();
    stateArg.selectedProfile = "balanced";
    expect(stateArg.selectedProfile).toBe("balanced");
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
    stateArg.debugHistory = [{ profile: "p" } as any];
    expect(stateArg.debugHistory.length).toBe(1);
    expect(stateArg.lastConfigWarnings).toEqual([]);
    expect(stateArg.failedByChain).toBeInstanceOf(Map);
    // Test the actions callbacks via the captured registerCommands call
    const actionsArg = vi.mocked(registerCommands).mock.calls[0][2] as any;
    const ctx = makeCtx();
    expect(() => actionsArg.updateStatus(ctx)).not.toThrow();
    expect(() => actionsArg.reloadConfig(ctx)).not.toThrow();
    expect(typeof actionsArg.ensureValidActiveRouterProfile).toBe("function");
  });

  it("handles debugEnabled notification on session_start", async () => {
    const { pi, listeners } = makePi();
    // Mock loadRouterConfig to return debug true
    vi.doMock("../../src/config", async () => {
      const actual = (await vi.importActual("../../src/config")) as any;
      return {
        ...actual,
        loadRouterConfig: vi.fn().mockReturnValue({
          config: { debug: true, profiles: { balanced: { medium: { models: ["openai/a"] } } } },
          warnings: [],
        }),
      };
    });
    routerExtension(pi);
    const ctx = makeCtx();
    // Need to set debugEnabled true via state, but we can just check that session_start handles it
    await listeners["session_start"]({}, ctx);
    // The notify for Router initialized should be called if debugEnabled is true
    // Since we mocked loadRouterConfig to return debug true, it should be true
  });

  it("handles model_select router with same contextWindow does not call setModelInternally", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    const registryModel = {
      provider: "router",
      id: "balanced",
      contextWindow: 100000,
      maxTokens: 4000,
    };
    ctx.modelRegistry.find = vi.fn().mockReturnValue(registryModel as any);
    // Use a fresh pi with spy
    const { pi: pi3, listeners: listeners3 } = makePi();
    // Override find to return same window as event
    const ctx3 = makeCtx({
      modelRegistry: { find: vi.fn().mockReturnValue(registryModel as any), list: vi.fn(() => []) },
    });
    pi3.setModel = vi.fn().mockResolvedValue(true);
    // We need to re-create extension with pi3 to capture setModel calls
    routerExtension(pi3);
    await listeners3["session_start"]({}, ctx3);
    // Clear setModel calls from session_start
    pi3.setModel.mockClear();
    await listeners3["model_select"](
      {
        model: {
          provider: "router",
          id: "balanced",
          contextWindow: 100000,
          maxTokens: 4000,
        } as any,
      },
      ctx3,
    );
    // Should not have called setModelInternally because windows are equal
    expect(pi3.setModel).not.toHaveBeenCalled();
  });

  it("handles model_select router with different maxTokens", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    // Use a fresh extension instance with a registry that returns different maxTokens
    const { pi: pi3, listeners: listeners3 } = makePi();
    const registryModel = {
      provider: "router",
      id: "balanced",
      contextWindow: 100000,
      maxTokens: 8000,
    };
    const ctx3 = makeCtx({
      modelRegistry: { find: vi.fn().mockReturnValue(registryModel as any), list: vi.fn(() => []) },
    });
    routerExtension(pi3);
    await listeners3["session_start"]({}, ctx3);
    await listeners3["model_select"](
      {
        model: {
          provider: "router",
          id: "balanced",
          contextWindow: 100000,
          maxTokens: 4000,
        } as any,
      },
      ctx3,
    );
    // Should handle without throwing and set routerEnabled
    expect(ctx3.ui.setStatus).toHaveBeenCalled();
  });

  it("handles model_select router with no registryModel", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    ctx.modelRegistry.find = vi.fn().mockReturnValue(undefined);
    await listeners["model_select"](
      { model: { provider: "router", id: "balanced", contextWindow: 100, maxTokens: 100 } as any },
      ctx,
    );
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("handles turn_end with no routerModel", async () => {
    const { pi, listeners } = makePi();
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    // Set routerEnabled and selectedProfile, but make find return undefined for turn_end
    ctx.model = { provider: "openai", id: "gpt-4o" } as any;
    ctx.modelRegistry.find = vi.fn().mockReturnValue(undefined);
    await listeners["turn_end"]({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });
});
