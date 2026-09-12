import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRouterState } from "../../src/state/create";

vi.mock("../../src/provider", async () => {
  const actual = await vi.importActual<typeof ProviderMod>("../../src/provider");
  return { ...actual, registerRouterProvider: vi.fn() };
});

import type * as ProviderMod from "../../src/provider";
import { createRouterActions } from "../../src/index/actions";
import { registerRouterProvider } from "../../src/provider";
import {
  makeFakeDecision,
  makeFakeExtensionContext,
  makeFakeModel,
  makeFakePi,
  makeFakeRegistry,
  makeFakeUi,
} from "../helpers";

describe("index/actions 모듈", () => {
  beforeEach(() => vi.clearAllMocks());

  it("register 경유로 모든 actions를 생성하고 getters/setters를 커버한다", async () => {
    const state = createRouterState();
    state.currentConfig = { profiles: { balanced: { medium: { models: ["openai/a"] } } } };
    state.lastRegisteredModels = "old";
    state.currentModelRegistry = makeFakeRegistry();
    state.lastExtensionContext = makeFakeExtensionContext();
    state.selectedProfile = "balanced";
    state.routerEnabled = true;
    state.lastDecision = makeFakeDecision({ profile: "balanced", tier: "high" });
    state.accumulatedCost = 5;
    state.failedByChain = new Map([["k", new Set(["v"])]]);

    const pi = makeFakePi();

    const actions = createRouterActions(pi, state);

    // Test the registerRouterProviderAction getters/setters
    const mock = vi.mocked(registerRouterProvider);
    actions.registerRouterProvider();
    expect(mock).toHaveBeenCalled();
    const firstCall = mock.mock.calls[0];
    if (firstCall === undefined) expect.unreachable();
    const stateArg = firstCall[1];
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
    const newDecision = makeFakeDecision({ profile: "p" });
    stateArg.lastDecision = newDecision;
    expect(state.lastDecision).toBe(newDecision);
    expect(stateArg.accumulatedCost).toBe(5);
    stateArg.accumulatedCost = 10;
    expect(state.accumulatedCost).toBe(10);
    expect(stateArg.failedByChain).toBe(state.failedByChain);

    // Also test the updateStatus callback
    const updateStatusMock = firstCall[2].updateStatus;
    const ctx = makeFakeExtensionContext({ ui: makeFakeUi() });
    // The updateStatus should call the real updateStatus with current state
    // We can't easily test without mocking ui, but we can ensure it doesn't throw
    expect(() => updateStatusMock(ctx)).not.toThrow();
  });

  it("persistState 중복 제거를 처리한다", async () => {
    const state = createRouterState();
    const appendEntry = vi.fn();
    const pi = makeFakePi({ appendEntry });
    const { createRouterActions: cr } = await import("../../src/index/actions");
    const actions = cr(pi, state);
    actions.persistState();
    const first = appendEntry.mock.calls.length;
    actions.persistState();
    expect(appendEntry.mock.calls.length).toBe(first);
  });

  it("tryFallbackByRef와 tryRestoreFallback을 처리한다", async () => {
    const state = createRouterState();
    const setModel = vi.fn().mockResolvedValue(true);
    const pi = makeFakePi({ setModel });
    const actions = createRouterActions(pi, state);
    const find = vi.fn().mockReturnValue(makeFakeModel({ provider: "openai", id: "gpt" }));
    const ctx = makeFakeExtensionContext({
      modelRegistry: makeFakeRegistry({ find }),
    });
    expect(await actions.tryFallbackByRef(ctx, "openai/gpt-4o")).toBe(true);
    expect(await actions.tryFallbackByRef(ctx, "invalid")).toBe(false);
    state.lastNonRouterModel = "openai/gpt";
    expect(await actions.tryRestoreFallback(ctx)).toBe(true);
  });

  it("ensureValidActiveRouterProfile을 처리한다", async () => {
    const state = createRouterState();
    state.currentConfig = { profiles: { balanced: {} } };
    const setModel = vi.fn().mockResolvedValue(true);
    const pi = makeFakePi({ setModel });
    const actions = createRouterActions(pi, state);
    const ctx = makeFakeExtensionContext({
      model: makeFakeModel({ provider: "router", id: "balanced" }),
      modelRegistry: makeFakeRegistry(),
    });
    await actions.ensureValidActiveRouterProfile(ctx);
    expect(state.routerEnabled).toBe(true);
  });
});
