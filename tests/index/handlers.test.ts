import { describe, expect, it, vi } from "vitest";
import {
  handleModelSelect,
  handleSessionStart,
  handleTurnEnd,
  handleTurnStart,
} from "../../src/index/handlers";
import { createRouterActions } from "../../src/index/actions";
import { createRouterState } from "../../src/state/create";
import {
  makeFakeExtensionContext,
  makeFakeModel,
  makeFakePi,
  makeFakeRegistry,
  makeFakeSessionManager,
  makeFakeUi,
} from "../helpers";

describe("index/handlers 모듈", () => {
  const makeState = () => {
    const s = createRouterState();
    s.currentConfig = { profiles: { balanced: { medium: { models: ["openai/a"] } } } };
    return s;
  };

  const makeActionsFor = (state: ReturnType<typeof createRouterState>) => {
    const setModelInternally = vi.fn().mockResolvedValue(true);
    const persistState = vi.fn();
    const reloadConfig = vi.fn();
    const ensureValidActiveRouterProfile = vi.fn().mockResolvedValue(undefined);
    const tryRestoreFallback = vi.fn().mockResolvedValue(false);
    const recordDebugDecision = vi.fn();
    const actions = createRouterActions(makeFakePi(), state);
    Object.assign(actions, {
      setModelInternally,
      persistState,
      reloadConfig,
      ensureValidActiveRouterProfile,
      tryRestoreFallback,
      recordDebugDecision,
    });
    return {
      actions,
      setModelInternally,
      persistState,
      reloadConfig,
      ensureValidActiveRouterProfile,
      tryRestoreFallback,
      recordDebugDecision,
    };
  };

  const makeUiMocks = () => {
    const notify = vi.fn();
    const setStatus = vi.fn();
    const setHiddenThinkingLabel = vi.fn();
    const ui = makeFakeUi({ notify, setStatus, setHiddenThinkingLabel });
    return { ui, notify, setStatus, setHiddenThinkingLabel };
  };

  const makeCtx = () => {
    const { ui, notify, setStatus, setHiddenThinkingLabel } = makeUiMocks();
    const find = vi.fn().mockReturnValue(makeFakeModel({ provider: "router", id: "balanced" }));
    const ctx = makeFakeExtensionContext({
      cwd: "/cwd",
      modelRegistry: makeFakeRegistry({ find }),
      model: makeFakeModel({ provider: "router", id: "balanced" }),
      sessionManager: makeFakeSessionManager({ getBranch: () => [] }),
      ui,
    });
    return { ctx, notify, setStatus, setHiddenThinkingLabel, find };
  };

  describe("handleSessionStart 함수", () => {
    it("초기화 상태를 설정하고 복원한다", async () => {
      const state = makeState();
      const { actions } = makeActionsFor(state);
      const { ctx } = makeCtx();
      await handleSessionStart({}, ctx, state, actions);
      expect(state.isInitialized).toBe(true);
    });

    it("debugEnabled일 때 알림한다", async () => {
      const state = makeState();
      state.debugEnabled = true;
      state.currentConfig = { profiles: { balanced: {} } };
      const bundled = makeActionsFor(state);
      const tryRestoreFallback = vi.fn().mockResolvedValue(false);
      Object.assign(bundled.actions, { tryRestoreFallback });
      const { ui, notify } = makeUiMocks();
      const find = vi.fn();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: makeFakeRegistry({ find }),
        sessionManager: makeFakeSessionManager({ getBranch: () => [] }),
        ui,
        model: makeFakeModel({ provider: "router", id: "balanced" }),
      });
      await handleSessionStart({}, ctx, state, bundled.actions);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("Router initialized"), "info");
    });
  });

  describe("handleModelSelect 함수", () => {
    it("초기화 전에는 무시한다", async () => {
      const state = makeState();
      state.isInitialized = false;
      const { actions, persistState } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({ find: vi.fn() }),
      });
      await handleModelSelect(
        { model: makeFakeModel({ provider: "router", id: "balanced" }) },
        ctx,
        state,
        actions,
      );
      expect(persistState).not.toHaveBeenCalled();
    });

    it("isInternalModelSwitch일 때는 무시한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      state.isInternalModelSwitch = 1;
      const { actions, persistState } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({ find: vi.fn() }),
      });
      await handleModelSelect(
        { model: makeFakeModel({ provider: "router", id: "balanced" }) },
        ctx,
        state,
        actions,
      );
      expect(persistState).not.toHaveBeenCalled();
    });

    it("router 유효 profile이다", async () => {
      const state = makeState();
      state.isInitialized = true;
      const { actions, persistState } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({
          find: vi.fn().mockReturnValue(
            makeFakeModel({
              provider: "router",
              id: "balanced",
              contextWindow: 100,
              maxTokens: 100,
            }),
          ),
        }),
      });
      await handleModelSelect(
        {
          model: makeFakeModel({
            provider: "router",
            id: "balanced",
            contextWindow: 100,
            maxTokens: 100,
          }),
        },
        ctx,
        state,
        actions,
      );
      expect(state.routerEnabled).toBe(true);
      expect(state.selectedProfile).toBe("balanced");
      expect(persistState).toHaveBeenCalled();
    });

    it("contextWindow가 다르면 setModelInternally를 호출한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      const { actions, setModelInternally } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({
          find: vi.fn().mockReturnValue(
            makeFakeModel({
              provider: "router",
              id: "balanced",
              contextWindow: 200,
              maxTokens: 200,
            }),
          ),
        }),
      });
      await handleModelSelect(
        {
          model: makeFakeModel({
            provider: "router",
            id: "balanced",
            contextWindow: 100,
            maxTokens: 100,
          }),
        },
        ctx,
        state,
        actions,
      );
      expect(setModelInternally).toHaveBeenCalled();
    });

    it("알 수 없는 router profile은 폴백으로 처리한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      state.currentConfig = { profiles: {} };
      const bundled = makeActionsFor(state);
      const tryRestoreFallback = vi.fn().mockResolvedValue(true);
      Object.assign(bundled.actions, { tryRestoreFallback });
      const { ui, notify } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({ find: vi.fn() }),
      });
      await handleModelSelect(
        { model: makeFakeModel({ provider: "router", id: "unknown" }) },
        ctx,
        state,
        bundled.actions,
      );
      expect(tryRestoreFallback).toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Unknown router profile"),
        "error",
      );
    });

    it("알 수 없는 router profile은 폴백 없이 처리한다", async () => {
      const state = makeState();
      state.isInitialized = true;
      state.currentConfig = { profiles: {} };
      const bundled = makeActionsFor(state);
      const tryRestoreFallback = vi.fn().mockResolvedValue(false);
      Object.assign(bundled.actions, { tryRestoreFallback });
      const { ui, notify } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({ find: vi.fn() }),
      });
      await handleModelSelect(
        { model: makeFakeModel({ provider: "router", id: "unknown" }) },
        ctx,
        state,
        bundled.actions,
      );
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("no fallback"), "warning");
    });

    it("non-router이다", async () => {
      const state = makeState();
      state.isInitialized = true;
      const { actions } = makeActionsFor(state);
      const { ui, setHiddenThinkingLabel } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        ui,
        modelRegistry: makeFakeRegistry({ find: vi.fn() }),
      });
      await handleModelSelect(
        { model: makeFakeModel({ provider: "openai", id: "gpt-4o" }) },
        ctx,
        state,
        actions,
      );
      expect(state.routerEnabled).toBe(false);
      expect(state.lastNonRouterModel).toBe("openai/gpt-4o");
      expect(setHiddenThinkingLabel).toHaveBeenCalled();
    });
  });

  describe("handleTurnStart 함수", () => {
    it("registry가 없으면 초기화한다", () => {
      const state = createRouterState();
      state.currentModelRegistry = undefined;
      const { actions, reloadConfig } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: makeFakeRegistry({ find: vi.fn() }),
        ui,
      });
      handleTurnStart({}, ctx, state, actions);
      expect(state.currentModelRegistry).toBe(ctx.modelRegistry);
      expect(reloadConfig).toHaveBeenCalledWith(ctx);
    });

    it("이미 초기화되었으면 아무 것도 하지 않는다", () => {
      const state = createRouterState();
      state.currentModelRegistry = makeFakeRegistry();
      const { actions, reloadConfig } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: makeFakeRegistry(),
        ui,
      });
      handleTurnStart({}, ctx, state, actions);
      expect(reloadConfig).not.toHaveBeenCalled();
    });
  });

  describe("handleTurnEnd 함수", () => {
    it("registry가 없으면 초기화한다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = undefined;
      const { actions } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: makeFakeRegistry({
          find: vi.fn().mockReturnValue(makeFakeModel({ provider: "router", id: "balanced" })),
        }),
        model: makeFakeModel({ provider: "openai", id: "gpt" }),
        ui,
      });
      await handleTurnEnd({}, ctx, state, actions);
      expect(state.currentModelRegistry).toBe(ctx.modelRegistry);
    });

    it("활성화되어 있고 router가 아니면 router model을 복원한다", async () => {
      const state = createRouterState();
      const registry = makeFakeRegistry({
        find: vi.fn().mockReturnValue(makeFakeModel({ provider: "router", id: "balanced" })),
      });
      state.currentModelRegistry = registry;
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const { actions, setModelInternally } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: registry,
        model: makeFakeModel({ provider: "openai", id: "gpt" }),
        ui,
      });
      await handleTurnEnd({}, ctx, state, actions);
      expect(setModelInternally).toHaveBeenCalled();
    });

    it("이미 router이면 복원하지 않는다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = makeFakeRegistry({ find: vi.fn() });
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const { actions, setModelInternally } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: makeFakeModel({ provider: "router", id: "balanced" }),
        ui,
      });
      await handleTurnEnd({}, ctx, state, actions);
      expect(setModelInternally).not.toHaveBeenCalled();
    });

    it("selectedProfile이 없으면 복원하지 않는다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = makeFakeRegistry({ find: vi.fn() });
      state.routerEnabled = true;
      state.selectedProfile = undefined;
      const { actions, setModelInternally } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: makeFakeModel({ provider: "openai", id: "gpt" }),
        ui,
      });
      await handleTurnEnd({}, ctx, state, actions);
      expect(setModelInternally).not.toHaveBeenCalled();
    });

    it("find가 undefined를 반환해도 처리한다", async () => {
      const state = createRouterState();
      state.currentModelRegistry = makeFakeRegistry({
        find: vi.fn().mockReturnValue(undefined),
      });
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const { actions, setModelInternally } = makeActionsFor(state);
      const { ui } = makeUiMocks();
      const ctx = makeFakeExtensionContext({
        cwd: "/cwd",
        modelRegistry: state.currentModelRegistry,
        model: makeFakeModel({ provider: "openai", id: "gpt" }),
        ui,
      });
      await handleTurnEnd({}, ctx, state, actions);
      expect(setModelInternally).not.toHaveBeenCalled();
    });
  });
});
