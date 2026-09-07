import { describe, expect, it, vi } from "vitest";
import {
  createEnsureValidActiveRouterProfile,
  createSetModelInternally,
  createTryFallbackByRef,
  createTryRestoreFallback,
} from "../../src/index/fallback";
import { createRouterState } from "../../src/state/create";

describe("index/fallback 모듈", () => {
  describe("createSetModelInternally 함수", () => {
    it("성공한다", async () => {
      const state = createRouterState();
      const pi = { setModel: vi.fn().mockResolvedValue(true) } as any;
      const fn = createSetModelInternally(pi, state);
      expect(await fn({ provider: "openai", id: "gpt" } as any)).toBe(true);
      expect(state.isInternalModelSwitch).toBe(0);
    });
    it("예외 발생 시 false를 반환한다", async () => {
      const state = createRouterState();
      const pi = { setModel: vi.fn().mockRejectedValue(new Error("fail")) } as any;
      const fn = createSetModelInternally(pi, state);
      expect(await fn({} as any)).toBe(false);
      expect(state.isInternalModelSwitch).toBe(0);
    });
    it("증가 후 감소한다", async () => {
      const state = createRouterState();
      let during = -1;
      const pi = {
        setModel: vi.fn().mockImplementation(async () => {
          during = state.isInternalModelSwitch;
          return true;
        }),
      } as any;
      const fn = createSetModelInternally(pi, state);
      await fn({} as any);
      expect(during).toBe(1);
      expect(state.isInternalModelSwitch).toBe(0);
    });
  });

  describe("createTryFallbackByRef 함수", () => {
    it("slash가 없으면 false를 반환한다", async () => {
      const state = createRouterState();
      const pi = { setModel: vi.fn() } as any;
      const setModel = vi.fn();
      const fn = createTryFallbackByRef(pi, state, setModel as any);
      expect(await fn({} as any, "noslash")).toBe(false);
    });
    it("찾아서 설정한다", async () => {
      const state = createRouterState();
      const pi = {} as any;
      const setModel = vi.fn().mockResolvedValue(true);
      const ctx = {
        modelRegistry: { find: vi.fn().mockReturnValue({ provider: "openai", id: "gpt" }) },
      } as any;
      const fn = createTryFallbackByRef(pi, state, setModel as any);
      expect(await fn(ctx, "openai/gpt-4o")).toBe(true);
      expect(setModel).toHaveBeenCalled();
    });
    it("find가 undefined를 반환하면 false이다", async () => {
      const state = createRouterState();
      const pi = {} as any;
      const setModel = vi.fn();
      const ctx = { modelRegistry: { find: vi.fn().mockReturnValue(undefined) } } as any;
      const fn = createTryFallbackByRef(pi, state, setModel as any);
      expect(await fn(ctx, "openai/gpt")).toBe(false);
    });
    it("find가 예외를 던지면 false이다", async () => {
      const state = createRouterState();
      const pi = {} as any;
      const setModel = vi.fn();
      const ctx = {
        modelRegistry: {
          find: vi.fn().mockImplementation(() => {
            throw new Error("fail");
          }),
        },
      } as any;
      const fn = createTryFallbackByRef(pi, state, setModel as any);
      expect(await fn(ctx, "openai/gpt")).toBe(false);
    });
    it("setModel이 false를 반환하면 false이다", async () => {
      const state = createRouterState();
      const pi = {} as any;
      const setModel = vi.fn().mockResolvedValue(false);
      const ctx = { modelRegistry: { find: vi.fn().mockReturnValue({}) } } as any;
      const fn = createTryFallbackByRef(pi, state, setModel as any);
      expect(await fn(ctx, "openai/gpt")).toBe(false);
    });
  });

  describe("createTryRestoreFallback 함수", () => {
    it("lastNonRouterModel을 먼저 사용한다", async () => {
      const state = createRouterState();
      state.lastNonRouterModel = "openai/gpt";
      const tryFallbackByRef = vi.fn().mockResolvedValue(true);
      const fn = createTryRestoreFallback(state, tryFallbackByRef as any);
      expect(await fn({} as any)).toBe(true);
      expect(tryFallbackByRef).toHaveBeenCalledWith(expect.anything(), "openai/gpt");
    });
    it("anyModel로 폴백한다", async () => {
      const state = createRouterState();
      state.lastNonRouterModel = undefined;
      const tryFallbackByRef = vi.fn().mockResolvedValue(true);
      const getAnyModel = vi.fn().mockReturnValue({ provider: "openai", id: "gpt" });
      const fn = createTryRestoreFallback(state, tryFallbackByRef as any, getAnyModel as any);
      expect(await fn({} as any)).toBe(true);
      expect(tryFallbackByRef).toHaveBeenCalledWith(expect.anything(), "openai/gpt");
    });
    it("anyModel이 undefined를 반환하면 false이다", async () => {
      const state = createRouterState();
      const tryFallbackByRef = vi.fn();
      const getAnyModel = vi.fn().mockReturnValue(undefined);
      const fn = createTryRestoreFallback(state, tryFallbackByRef as any, getAnyModel as any);
      expect(await fn({} as any)).toBe(false);
    });
    it("tryFallbackByRef가 false이면 anyModel도 false이다", async () => {
      const state = createRouterState();
      state.lastNonRouterModel = "openai/gpt";
      const tryFallbackByRef = vi.fn().mockResolvedValue(false);
      const getAnyModel = vi.fn().mockReturnValue({ provider: "a", id: "b" });
      const fn = createTryRestoreFallback(state, tryFallbackByRef as any, getAnyModel as any);
      // first call with lastNonRouterModel returns false, second with anyModel also false
      tryFallbackByRef.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      expect(await fn({} as any)).toBe(false);
    });
    it("getAnyModel 예외를 처리한다", async () => {
      const state = createRouterState();
      const tryFallbackByRef = vi.fn();
      const getAnyModel = vi.fn().mockImplementation(() => {
        throw new Error("fail");
      });
      const fn = createTryRestoreFallback(state, tryFallbackByRef as any, getAnyModel as any);
      expect(await fn({} as any)).toBe(false);
    });
  });

  describe("createEnsureValidActiveRouterProfile 함수", () => {
    it("router provider가 아니면 반환한다", async () => {
      const state = createRouterState();
      const fn = createEnsureValidActiveRouterProfile(state, vi.fn() as any);
      const ctx = { model: { provider: "openai", id: "gpt" }, ui: { notify: vi.fn() } } as any;
      await fn(ctx);
      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });
    it("model이 없으면 반환한다", async () => {
      const state = createRouterState();
      const fn = createEnsureValidActiveRouterProfile(state, vi.fn() as any);
      await fn({ ui: { notify: vi.fn() } } as any);
      // should return early, no notify
    });
    it("유효한 profile이다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: {} } } as any;
      const fn = createEnsureValidActiveRouterProfile(state, vi.fn() as any);
      const ctx = { model: { provider: "router", id: "balanced" }, ui: { notify: vi.fn() } } as any;
      await fn(ctx);
      expect(state.selectedProfile).toBe("balanced");
      expect(state.routerEnabled).toBe(true);
    });
    it("유효하지 않은 profile은 폴백 성공 시 처리한다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const tryRestoreFallback = vi.fn().mockResolvedValue(true);
      const fn = createEnsureValidActiveRouterProfile(state, tryRestoreFallback as any);
      const ctx = { model: { provider: "router", id: "unknown" }, ui: { notify: vi.fn() } } as any;
      await fn(ctx);
      expect(state.routerEnabled).toBe(false);
      expect(state.selectedProfile).toBeUndefined();
      expect(tryRestoreFallback).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("no longer configured"),
        "warning",
      );
    });
    it("유효하지 않은 profile은 폴백 실패 시 처리한다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const tryRestoreFallback = vi.fn().mockResolvedValue(false);
      const fn = createEnsureValidActiveRouterProfile(state, tryRestoreFallback as any);
      const ctx = { model: { provider: "router", id: "unknown" }, ui: { notify: vi.fn() } } as any;
      await fn(ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("no fallback"), "warning");
    });
  });
});
