import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRouterState } from "../../src/state/create";

vi.mock("../../src/provider", async () => {
  const actual = (await vi.importActual("../../src/provider")) as any;
  return { ...actual, registerRouterProvider: vi.fn() };
});

import { createRouterActions } from "../../src/index/actions";
import { registerRouterProvider } from "../../src/provider";

describe("index/actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates all actions and covers getters/setters via register", async () => {
    const state = createRouterState();
    state.currentConfig = { profiles: { balanced: { medium: { models: ["openai/a"] } } } } as any;
    state.lastRegisteredModels = "old";
    state.currentModelRegistry = { find: vi.fn() } as any;
    state.lastExtensionContext = { ui: {} } as any;
    state.selectedProfile = "balanced";
    state.routerEnabled = true;
    state.lastDecision = { profile: "balanced", tier: "high" } as any;
    state.accumulatedCost = 5;
    state.failedByChain = new Map([["k", new Set(["v"])]]);

    const pi = {
      appendEntry: vi.fn(),
      setModel: vi.fn().mockResolvedValue(true),
      registerProvider: vi.fn(),
    } as any;

    const actions = createRouterActions(pi, state);

    // Test the registerRouterProviderAction getters/setters
    const mock = vi.mocked(registerRouterProvider);
    actions.registerRouterProvider();
    expect(mock).toHaveBeenCalled();
    const stateArg = mock.mock.calls[0][1] as any;
    // Exercise getters
    expect(stateArg.lastRegisteredModels).toBe("old");
    stateArg.lastRegisteredModels = "new";
    expect(state.lastRegisteredModels).toBe("new");
    expect(stateArg.currentConfig).toBe(state.currentConfig);
    expect(stateArg.currentModelRegistry).toBe(state.currentModelRegistry);
    expect(stateArg.lastExtensionContext).toBe(state.lastExtensionContext);
    expect(stateArg.selectedProfile).toBe("balanced");
    stateArg.selectedProfile = "x";
    expect(state.selectedProfile).toBe("x");
    expect(stateArg.routerEnabled).toBe(true);
    stateArg.routerEnabled = false;
    expect(state.routerEnabled).toBe(false);
    expect(stateArg.lastDecision).toBe(state.lastDecision);
    const newDecision = { profile: "p" } as any;
    stateArg.lastDecision = newDecision;
    expect(state.lastDecision).toBe(newDecision);
    expect(stateArg.accumulatedCost).toBe(5);
    stateArg.accumulatedCost = 10;
    expect(state.accumulatedCost).toBe(10);
    expect(stateArg.failedByChain).toBe(state.failedByChain);

    // Also test the updateStatus callback
    const updateStatusMock = mock.mock.calls[0][2].updateStatus;
    const ctx = { ui: { setStatus: vi.fn() } } as any;
    // The updateStatus should call the real updateStatus with current state
    // We can't easily test without mocking ui, but we can ensure it doesn't throw
    expect(() => updateStatusMock(ctx)).not.toThrow();
  });

  it("handles persistState dedup", async () => {
    const state = createRouterState();
    const pi = { appendEntry: vi.fn(), setModel: vi.fn() } as any;
    const { createRouterActions: cr } = await import("../../src/index/actions");
    const actions = cr(pi, state);
    actions.persistState();
    const first = pi.appendEntry.mock.calls.length;
    actions.persistState();
    expect(pi.appendEntry.mock.calls.length).toBe(first);
  });

  it("handles tryFallbackByRef and tryRestoreFallback", async () => {
    const state = createRouterState();
    const pi = { appendEntry: vi.fn(), setModel: vi.fn().mockResolvedValue(true) } as any;
    const actions = createRouterActions(pi, state);
    const ctx = {
      modelRegistry: { find: vi.fn().mockReturnValue({ provider: "openai", id: "gpt" }) },
    } as any;
    expect(await actions.tryFallbackByRef(ctx, "openai/gpt-4o")).toBe(true);
    expect(await actions.tryFallbackByRef(ctx, "invalid")).toBe(false);
    state.lastNonRouterModel = "openai/gpt";
    expect(await actions.tryRestoreFallback(ctx)).toBe(true);
  });

  it("handles ensureValidActiveRouterProfile", async () => {
    const state = createRouterState();
    state.currentConfig = { profiles: { balanced: {} } } as any;
    const pi = { appendEntry: vi.fn(), setModel: vi.fn().mockResolvedValue(true) } as any;
    const actions = createRouterActions(pi, state);
    const ctx = {
      model: { provider: "router", id: "balanced" },
      ui: { notify: vi.fn() },
      modelRegistry: { find: vi.fn() },
    } as any;
    await actions.ensureValidActiveRouterProfile(ctx);
    expect(state.routerEnabled).toBe(true);
  });
});
