import { describe, expect, it, vi } from "vitest";
import {
  handleModelSelect,
  handleSessionStart,
  handleTurnEnd,
  handleTurnStart,
} from "../../src/index/handlers";
import { createRouterState } from "../../src/state/create";

describe("index/handlers", () => {
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

  describe("handleSessionStart", () => {
    it("sets initialized and restores", async () => {
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

    it("notifies when debugEnabled", async () => {
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

  describe("handleModelSelect", () => {
    it("ignores before initialization", async () => {
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

    it("ignores when isInternalModelSwitch", async () => {
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

    it("router valid profile", async () => {
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

    it("router valid with different contextWindow triggers setModelInternally", async () => {
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

    it("router unknown profile with fallback", async () => {
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

    it("router unknown no fallback", async () => {
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

    it("non-router", async () => {
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

  describe("handleTurnStart", () => {
    it("initializes when no registry", () => {
      const state = createRouterState();
      state.currentModelRegistry = undefined;
      const actions: any = { reloadConfig: vi.fn() };
      const ctx: any = { cwd: "/cwd", modelRegistry: { find: vi.fn() }, ui: {} };
      handleTurnStart({}, ctx, state, actions);
      expect(state.currentModelRegistry).toBe(ctx.modelRegistry);
      expect(actions.reloadConfig).toHaveBeenCalledWith(ctx);
    });

    it("does nothing when already initialized", () => {
      const state = createRouterState();
      state.currentModelRegistry = {} as any;
      const actions: any = { reloadConfig: vi.fn() };
      const ctx: any = { cwd: "/cwd", modelRegistry: {}, ui: {} };
      handleTurnStart({}, ctx, state, actions);
      expect(actions.reloadConfig).not.toHaveBeenCalled();
    });
  });

  describe("handleTurnEnd", () => {
    it("initializes when no registry", async () => {
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

    it("restores router model when enabled and not router", async () => {
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

    it("does not restore when already router", async () => {
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

    it("does not restore when no selectedProfile", async () => {
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

    it("handles find returning undefined", async () => {
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
