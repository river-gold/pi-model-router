import { describe, expect, it, vi } from "vitest";
import {
  handleModelSelect,
  handleSessionStart,
  handleTurnEnd,
  handleTurnStart,
} from "../../src/index/handlers";
import { createRouterState } from "../../src/state/create";

describe("index/handlers 모듈", () => {
  const makeState = () => {
    const s = createRouterState();
    s.currentConfig = { profiles: { balanced: { medium: { models: ["openai/a"] } } } } as any;
    return s;
  };

  const makeActions = (over: any = {}) => ({
    setModelInternally: vi.fn().mockResolvedValue(true),
    persistState: vi.fn(),
    reloadConfig: vi.fn(),
    ensureValidActiveRouterProfile: vi.fn().mockResolvedValue(undefined),
    tryRestoreFallback: vi.fn().mockResolvedValue(false),
    recordDebugDecision: vi.fn(),
    ...over,
  });

  describe("handleSessionStart 함수", () => {
    it("초기화 상태를 설정하고 복원한다", async () => {
      const state = makeState();
      const actions: any = makeActions();
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: { find: vi.fn().mockReturnValue({ provider: "router", id: "balanced" }) },
        model: { provider: "router", id: "balanced" },
        sessionManager: { getBranch: () => [] },
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
      };
      await handleSessionStart({}, ctx, state, actions);
      expect(state.isInitialized).toBe(true);
    });

    it("debugEnabled일 때 알림한다", async () => {
      const state = makeState();
      state.debugEnabled = true;
      state.currentConfig = { profiles: { balanced: {} } } as any;
      const actions: any = {
        setModelInternally: vi.fn(),
        persistState: vi.fn(),
        reloadConfig: vi.fn(),
        ensureValidActiveRouterProfile: vi.fn().mockResolvedValue(undefined),
      };
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: { find: vi.fn() },
        sessionManager: { getBranch: () => [] },
        ui: { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_: string, t: string) => t } },
        model: { provider: "router", id: "balanced" },
      };
      await handleSessionStart({}, ctx, state, actions);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Router initialized"),
        "info",
      );
    });
  });

  describe("handleModelSelect 함수", () => {
    it("초기화 전에는 무시한다", async () => {
      const state = makeState();
      state.isInitialized = false;
      const actions: any = makeActions();
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: { find: vi.fn() },
      };
      await handleModelSelect(
        { model: { provider: "router", id: "balanced" } as any },
        ctx,
        state,
        actions,
      );
      expect(actions.persistState).not.toHaveBeenCalled();
    });

    it("isInternalModelSwitch일 때는 무시한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      state.isInternalModelSwitch = 1;
      const actions: any = makeActions();
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: { find: vi.fn() },
      };
      await handleModelSelect(
        { model: { provider: "router", id: "balanced" } as any },
        ctx,
        state,
        actions,
      );
      expect(actions.persistState).not.toHaveBeenCalled();
    });

    it("router 유효 profile이다", async () => {
      const state = makeState();
      state.isInitialized = true;
      const actions: any = makeActions();
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: {
          find: vi.fn().mockReturnValue({
            provider: "router",
            id: "balanced",
            contextWindow: 100,
            maxTokens: 100,
          }),
        },
      };
      await handleModelSelect(
        {
          model: { provider: "router", id: "balanced", contextWindow: 100, maxTokens: 100 } as any,
        },
        ctx,
        state,
        actions,
      );
      expect(state.routerEnabled).toBe(true);
      expect(state.selectedProfile).toBe("balanced");
      expect(actions.persistState).toHaveBeenCalled();
    });

    it("contextWindow가 다르면 setModelInternally를 호출한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      const actions: any = makeActions();
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: {
          find: vi.fn().mockReturnValue({
            provider: "router",
            id: "balanced",
            contextWindow: 200,
            maxTokens: 200,
          }),
        },
      };
      await handleModelSelect(
        {
          model: { provider: "router", id: "balanced", contextWindow: 100, maxTokens: 100 } as any,
        },
        ctx,
        state,
        actions,
      );
      expect(actions.setModelInternally).toHaveBeenCalled();
    });

    it("알 수 없는 router profile은 폴백으로 처리한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      state.currentConfig = { profiles: {} } as any;
      const actions: any = {
        ...makeActions(),
        tryRestoreFallback: vi.fn().mockResolvedValue(true),
      };
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: { find: vi.fn() },
      };
      await handleModelSelect(
        { model: { provider: "router", id: "unknown" } as any },
        ctx,
        state,
        actions,
      );
      expect(actions.tryRestoreFallback).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Unknown router profile"),
        "error",
      );
    });

    it("알 수 없는 router profile은 폴백 없이 처리한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      state.currentConfig = { profiles: {} } as any;
      const actions: any = {
        ...makeActions(),
        tryRestoreFallback: vi.fn().mockResolvedValue(false),
      };
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: { find: vi.fn() },
      };
      await handleModelSelect(
        { model: { provider: "router", id: "unknown" } as any },
        ctx,
        state,
        actions,
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("no fallback"), "warning");
    });

    it("non-router이다", async () => {
      const state = makeState();
      state.isInitialized = true;
      const actions: any = makeActions();
      const ctx: any = {
        ui: {
          notify: vi.fn(),
          setHiddenThinkingLabel: vi.fn(),
          setStatus: vi.fn(),
          theme: { fg: (_: string, t: string) => t },
        },
        modelRegistry: { find: vi.fn() },
      };
      await handleModelSelect(
        { model: { provider: "openai", id: "gpt-4o" } as any },
        ctx,
        state,
        actions,
      );
      expect(state.routerEnabled).toBe(false);
      expect(state.lastNonRouterModel).toBe("openai/gpt-4o");
      expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
    });
  });

  describe("handleTurnStart 함수", () => {
    it("registry가 없으면 초기화한다", () => {
      const state = createRouterState();
      state.currentModelRegistry = undefined;
      const actions: any = { reloadConfig: vi.fn() };
      const ctx: any = { cwd: "/cwd", modelRegistry: { find: vi.fn() }, ui: {} };
      handleTurnStart({}, ctx, state, actions);
      expect(state.currentModelRegistry).toBe(ctx.modelRegistry);
      expect(actions.reloadConfig).toHaveBeenCalledWith(ctx);
    });

    it("이미 초기화되었으면 아무 것도 하지 않는다", () => {
      const state = createRouterState();
      state.currentModelRegistry = {} as any;
      const actions: any = { reloadConfig: vi.fn() };
      const ctx: any = { cwd: "/cwd", modelRegistry: {}, ui: {} };
      handleTurnStart({}, ctx, state, actions);
      expect(actions.reloadConfig).not.toHaveBeenCalled();
    });
  });

  describe("handleTurnEnd 함수", () => {
    it("registry가 없으면 초기화한다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = undefined;
      const actions: any = { reloadConfig: vi.fn(), persistState: vi.fn() };
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: { find: vi.fn().mockReturnValue({ provider: "router", id: "balanced" }) },
        model: { provider: "openai", id: "gpt" },
        ui: { setStatus: vi.fn(), theme: { fg: (_: string, t: string) => t } },
      };
      await handleTurnEnd({}, ctx, state, actions);
      expect(state.currentModelRegistry).toBe(ctx.modelRegistry);
    });

    it("활성화되어 있고 router가 아니면 router model을 복원한다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = {
        find: vi.fn().mockReturnValue({ provider: "router", id: "balanced" }),
      } as any;
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const actions: any = {
        reloadConfig: vi.fn(),
        persistState: vi.fn(),
        setModelInternally: vi.fn().mockResolvedValue(true),
      };
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: { provider: "openai", id: "gpt" },
        ui: { setStatus: vi.fn(), theme: { fg: (_: string, t: string) => t } },
      };
      await handleTurnEnd({}, ctx, state, actions);
      expect(actions.setModelInternally).toHaveBeenCalled();
    });

    it("이미 router이면 복원하지 않는다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = { find: vi.fn() } as any;
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const actions: any = {
        reloadConfig: vi.fn(),
        persistState: vi.fn(),
        setModelInternally: vi.fn(),
      };
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: { provider: "router", id: "balanced" },
        ui: { setStatus: vi.fn(), theme: { fg: (_: string, t: string) => t } },
      };
      await handleTurnEnd({}, ctx, state, actions);
      expect(actions.setModelInternally).not.toHaveBeenCalled();
    });

    it("selectedProfile이 없으면 복원하지 않는다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = { find: vi.fn() } as any;
      state.routerEnabled = true;
      state.selectedProfile = undefined;
      const actions: any = {
        reloadConfig: vi.fn(),
        persistState: vi.fn(),
        setModelInternally: vi.fn(),
      };
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: { provider: "openai", id: "gpt" },
        ui: { setStatus: vi.fn(), theme: { fg: (_: string, t: string) => t } },
      };
      await handleTurnEnd({}, ctx, state, actions);
      expect(actions.setModelInternally).not.toHaveBeenCalled();
    });

    it("find가 undefined를 반환해도 처리한다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = { find: vi.fn().mockReturnValue(undefined) } as any;
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const actions: any = {
        reloadConfig: vi.fn(),
        persistState: vi.fn(),
        setModelInternally: vi.fn(),
      };
      const ctx: any = {
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: { provider: "openai", id: "gpt" },
        ui: { setStatus: vi.fn(), theme: { fg: (_: string, t: string) => t } },
      };
      await handleTurnEnd({}, ctx, state, actions);
      expect(actions.setModelInternally).not.toHaveBeenCalled();
    });
  });
});
