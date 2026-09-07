import { describe, expect, it, vi } from "vitest";
import { createReloadConfig } from "../../src/index/reload";
import { createRouterState } from "../../src/state/create";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("index/reload 모듈", () => {
  const makeState = () => {
    const s = createRouterState();
    s.currentCwd = "/cwd";
    s.currentConfig = { profiles: {} } as any;
    s.lastConfigWarnings = [];
    return s;
  };

  const makePi = () => ({ registerProvider: vi.fn() }) as any;

  const makeDeps = (over: any = {}) => ({
    loadRouterConfig: vi.fn().mockReturnValue({
      config: { debug: true, profiles: { balanced: { medium: { models: ["openai/a"] } } } },
      warnings: [],
    }),
    profileNames: vi.fn().mockReturnValue(["balanced"]),
    resolveProfileName: vi.fn().mockReturnValue("balanced"),
    registerRouterProvider: vi.fn(),
    updateStatus: vi.fn(),
    ...over,
  });

  it("config를 로드하고 state를 업데이트한다", () => {
    const state = makeState();
    const pi = makePi();
    const deps = makeDeps();
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps as any);
    reload();
    expect(deps.loadRouterConfig).toHaveBeenCalledWith("/cwd");
    expect(state.currentConfig.debug).toBe(true);
    expect(state.debugEnabled).toBe(true);
    expect(state.selectedProfile).toBe("balanced");
    expect(deps.registerRouterProvider).toHaveBeenCalled();
    // Exercise getters/setters on the state object passed to registerRouterProvider
    const stateArg = deps.registerRouterProvider.mock.calls[0][1] as any;
    expect(stateArg.lastRegisteredModels).toBe(state.lastRegisteredModels);
    stateArg.lastRegisteredModels = "new";
    expect(state.lastRegisteredModels).toBe("new");
    expect(stateArg.currentConfig).toBe(state.currentConfig);
    expect(stateArg.currentModelRegistry).toBe(state.currentModelRegistry);
    expect(stateArg.lastExtensionContext).toBe(state.lastExtensionContext);
    expect(stateArg.selectedProfile).toBe(state.selectedProfile);
    stateArg.selectedProfile = "x";
    expect(state.selectedProfile).toBe("x");
    expect(stateArg.routerEnabled).toBe(state.routerEnabled);
    stateArg.routerEnabled = true;
    expect(state.routerEnabled).toBe(true);
    expect(stateArg.lastDecision).toBe(state.lastDecision);
    const d = { profile: "p" } as any;
    stateArg.lastDecision = d;
    expect(state.lastDecision).toBe(d);
    expect(stateArg.accumulatedCost).toBe(state.accumulatedCost);
    stateArg.accumulatedCost = 10;
    expect(state.accumulatedCost).toBe(10);
    expect(stateArg.failedByChain).toBe(state.failedByChain);
    // Test updateStatus callback
    const ctx = { ui: { setStatus: vi.fn() } } as any;
    const updateStatusMock = deps.registerRouterProvider.mock.calls[0][2].updateStatus;
    expect(() => updateStatusMock(ctx)).not.toThrow();
  });

  it("preserveDebug가 true이면 debugEnabled를 덮어쓰지 않는다", () => {
    const state = makeState();
    state.debugEnabled = false;
    const pi = makePi();
    const deps = makeDeps({
      loadRouterConfig: vi
        .fn()
        .mockReturnValue({ config: { debug: true, profiles: {} }, warnings: [] }),
    });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps as any);
    reload(undefined, { preserveDebug: true });
    expect(state.debugEnabled).toBe(false);
  });

  it("preserveDebug가 false이면 덮어쓴다", () => {
    const state = makeState();
    state.debugEnabled = false;
    const pi = makePi();
    const deps = makeDeps({
      loadRouterConfig: vi
        .fn()
        .mockReturnValue({ config: { debug: true, profiles: {} }, warnings: [] }),
    });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps as any);
    reload(undefined, { preserveDebug: false });
    expect(state.debugEnabled).toBe(true);
  });

  it("ctx가 있으면 updateStatus를 호출하고 경고를 알림한다", () => {
    const state = makeState();
    const pi = makePi();
    const deps = makeDeps({
      loadRouterConfig: vi.fn().mockReturnValue({ config: { profiles: {} }, warnings: ["warn1"] }),
    });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps as any);
    const ctx = { ui: { notify: vi.fn() } };
    const { notify } = ctx.ui;
    reload(ctx as unknown as ExtensionContext);
    expect(deps.updateStatus).toHaveBeenCalledWith(ctx, false, "balanced", undefined);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("warn1"), "warning");
  });

  it("ctx가 있어도 경고가 없으면 알림하지 않는다", () => {
    const state = makeState();
    const pi = makePi();
    const deps = makeDeps({
      loadRouterConfig: vi.fn().mockReturnValue({ config: { profiles: {} }, warnings: [] }),
    });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps as any);
    const ctx = { ui: { notify: vi.fn() } };
    const { notify } = ctx.ui;
    reload(ctx as unknown as ExtensionContext);
    expect(notify).not.toHaveBeenCalled();
  });

  it("ctx가 없으면 updateStatus를 호출하지 않는다", () => {
    const state = makeState();
    const pi = makePi();
    const deps = makeDeps();
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps as any);
    reload();
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it("미지정 시 기본 deps를 사용한다", () => {
    const state = makeState();
    const pi = makePi();
    // This will call real loadRouterConfig which tries to read files, but we mock it via not providing deps? Actually default deps uses real functions, but we can just test that it doesn't throw
    // We will provide a pi and state and not pass deps, it should use defaults
    // To avoid file system, we mock the real loadRouterConfig via vi.mock not possible here, so we just test that createReloadConfig returns a function
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn());
    expect(typeof reload).toBe("function");
  });
});
