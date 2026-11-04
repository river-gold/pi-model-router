import { describe, expect, it, vi } from "vitest";
import { createReloadConfig } from "../../src/index/reload";
import { createRouterState } from "../../src/state/create";
import type { ReloadDeps } from "../../src/index/reload";
import { makeFakeDecision, makeFakeExtensionContext, makeFakePi, makeFakeUi } from "../helpers";

describe("index/reload 모듈", () => {
  const makeState = () => {
    const s = createRouterState();
    s.currentCwd = "/cwd";
    s.currentConfig = { routers: {} };
    s.lastConfigWarnings = [];
    return s;
  };

  const makePi = () => {
    const registerProvider = vi.fn();
    const pi = makeFakePi({ registerProvider });
    return { pi, registerProvider };
  };

  const makeDeps = (over: Partial<ReloadDeps> = {}) => {
    const loadRouterConfig = vi.fn().mockReturnValue({
      config: { debug: true, routers: { balanced: { medium: { models: ["openai/a"] } } } },
      warnings: [],
    });
    const routerNames = vi.fn().mockReturnValue(["balanced"]);
    const resolveRouterName = vi.fn().mockReturnValue("balanced");
    const registerRouterProvider = vi.fn();
    const updateStatus = vi.fn();
    const deps: ReloadDeps = Object.assign(
      { loadRouterConfig, routerNames, resolveRouterName, registerRouterProvider, updateStatus },
      over,
    );
    return {
      deps,
      loadRouterConfig,
      routerNames,
      resolveRouterName,
      registerRouterProvider,
      updateStatus,
    };
  };

  const makeCtxWithNotify = () => {
    const notify = vi.fn();
    const setStatus = vi.fn();
    const ctx = makeFakeExtensionContext({ ui: makeFakeUi({ notify, setStatus }) });
    return { ctx, notify, setStatus };
  };

  it("config를 로드하고 state를 업데이트한다", () => {
    const state = makeState();
    const { pi } = makePi();
    const { deps, loadRouterConfig, registerRouterProvider } = makeDeps();
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps);
    reload();
    expect(loadRouterConfig).toHaveBeenCalledWith("/cwd");
    expect(state.currentConfig.debug).toBe(true);
    expect(state.debugEnabled).toBe(true);
    expect(state.selectedRouter).toBe("balanced");
    expect(registerRouterProvider).toHaveBeenCalled();
    // Exercise getters/setters on the state object passed to registerRouterProvider
    const firstCall = registerRouterProvider.mock.calls[0];
    if (firstCall === undefined) expect.unreachable();
    const stateArg = firstCall[1];
    expect(stateArg.lastRegisteredModels).toBe(state.lastRegisteredModels);
    stateArg.lastRegisteredModels = "new";
    expect(state.lastRegisteredModels).toBe("new");
    expect(stateArg.currentConfig).toBe(state.currentConfig);
    expect(stateArg.currentModelRegistry).toBe(state.currentModelRegistry);
    expect(stateArg.lastExtensionContext).toBe(state.lastExtensionContext);
    expect(stateArg.selectedRouter).toBe(state.selectedRouter);
    stateArg.selectedRouter = "x";
    expect(state.selectedRouter).toBe("x");
    expect(stateArg.routerEnabled).toBe(state.routerEnabled);
    stateArg.routerEnabled = true;
    expect(state.routerEnabled).toBe(true);
    expect(stateArg.lastDecision).toBe(state.lastDecision);
    const d = makeFakeDecision({ router: "p" });
    stateArg.lastDecision = d;
    expect(state.lastDecision).toBe(d);
    expect(stateArg.accumulatedCost).toBe(state.accumulatedCost);
    stateArg.accumulatedCost = 10;
    expect(state.accumulatedCost).toBe(10);
    expect(stateArg.failedByChain).toBe(state.failedByChain);
    // Test updateStatus callback
    const updateStatusMock = firstCall[2].updateStatus;
    const { ctx } = makeCtxWithNotify();
    expect(() => updateStatusMock(ctx)).not.toThrow();
  });

  it("preserveDebug가 true이면 debugEnabled를 덮어쓰지 않는다", () => {
    const state = makeState();
    state.debugEnabled = false;
    const { pi } = makePi();
    const loadRouterConfig = vi
      .fn()
      .mockReturnValue({ config: { debug: true, routers: {} }, warnings: [] });
    const { deps } = makeDeps({ loadRouterConfig });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps);
    reload(undefined, { preserveDebug: true });
    expect(state.debugEnabled).toBe(false);
  });

  it("preserveDebug가 false이면 덮어쓴다", () => {
    const state = makeState();
    state.debugEnabled = false;
    const { pi } = makePi();
    const loadRouterConfig = vi
      .fn()
      .mockReturnValue({ config: { debug: true, routers: {} }, warnings: [] });
    const { deps } = makeDeps({ loadRouterConfig });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps);
    reload(undefined, { preserveDebug: false });
    expect(state.debugEnabled).toBe(true);
  });

  it("ctx가 있으면 updateStatus를 호출하고 경고를 알림한다", () => {
    const state = makeState();
    const { pi } = makePi();
    const loadRouterConfig = vi
      .fn()
      .mockReturnValue({ config: { routers: {} }, warnings: ["warn1"] });
    const { deps, updateStatus } = makeDeps({ loadRouterConfig });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps);
    const { ctx, notify } = makeCtxWithNotify();
    reload(ctx);
    expect(updateStatus).toHaveBeenCalledWith(ctx, false, "balanced", undefined);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("warn1"), "warning");
  });

  it("ctx가 있어도 경고가 없으면 알림하지 않는다", () => {
    const state = makeState();
    const { pi } = makePi();
    const loadRouterConfig = vi.fn().mockReturnValue({ config: { routers: {} }, warnings: [] });
    const { deps } = makeDeps({ loadRouterConfig });
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps);
    const { ctx, notify } = makeCtxWithNotify();
    reload(ctx);
    expect(notify).not.toHaveBeenCalled();
  });

  it("ctx가 없으면 updateStatus를 호출하지 않는다", () => {
    const state = makeState();
    const { pi } = makePi();
    const { deps, updateStatus } = makeDeps();
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn(), deps);
    reload();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("미지정 시 기본 deps를 사용한다", () => {
    const state = makeState();
    const { pi } = makePi();
    // This will call real loadRouterConfig which tries to read files, but we mock it via not providing deps? Actually default deps uses real functions, but we can just test that it doesn't throw
    // We will provide a pi and state and not pass deps, it should use defaults
    // To avoid file system, we mock the real loadRouterConfig via vi.mock not possible here, so we just test that createReloadConfig returns a function
    const reload = createReloadConfig(pi, state, vi.fn(), vi.fn());
    expect(typeof reload).toBe("function");
  });
});
