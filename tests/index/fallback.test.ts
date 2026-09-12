import { describe, expect, it, vi } from "vitest";
import {
  createEnsureValidActiveRouterProfile,
  createSetModelInternally,
  createTryFallbackByRef,
  createTryRestoreFallback,
} from "../../src/index/fallback";
import { createRouterState } from "../../src/state/create";
import {
  makeFakeExtensionContext,
  makeFakeModel,
  makeFakePi,
  makeFakeRegistry,
  makeFakeUi,
} from "../helpers";

describe("index/fallback 모듈", () => {
  describe("createSetModelInternally 함수", () => {
    it("성공한다", async () => {
      const state = createRouterState();
      const setModel = vi.fn().mockResolvedValue(true);
      const pi = makeFakePi({ setModel });
      const fn = createSetModelInternally(pi, state);
      expect(await fn(makeFakeModel({ provider: "openai", id: "gpt" }))).toBe(true);
      expect(state.isInternalModelSwitch).toBe(0);
    });
    it("예외 발생 시 false를 반환한다", async () => {
      const state = createRouterState();
      const setModel = vi.fn().mockRejectedValue(new Error("fail"));
      const pi = makeFakePi({ setModel });
      const fn = createSetModelInternally(pi, state);
      expect(await fn(makeFakeModel())).toBe(false);
      expect(state.isInternalModelSwitch).toBe(0);
    });
    it("증가 후 감소한다", async () => {
      const state = createRouterState();
      let during = -1;
      const setModel = vi.fn().mockImplementation(async () => {
        during = state.isInternalModelSwitch;
        return true;
      });
      const pi = makeFakePi({ setModel });
      const fn = createSetModelInternally(pi, state);
      await fn(makeFakeModel());
      expect(during).toBe(1);
      expect(state.isInternalModelSwitch).toBe(0);
    });
  });

  describe("createTryFallbackByRef 함수", () => {
    it("slash가 없으면 false를 반환한다", async () => {
      const state = createRouterState();
      const pi = makeFakePi();
      const setModel = vi.fn();
      const fn = createTryFallbackByRef(pi, state, setModel);
      expect(await fn(makeFakeExtensionContext(), "noslash")).toBe(false);
    });
    it("찾아서 설정한다", async () => {
      const state = createRouterState();
      const pi = makeFakePi();
      const setModel = vi.fn().mockResolvedValue(true);
      const find = vi.fn().mockReturnValue(makeFakeModel({ provider: "openai", id: "gpt" }));
      const ctx = makeFakeExtensionContext({
        modelRegistry: makeFakeRegistry({ find }),
      });
      const fn = createTryFallbackByRef(pi, state, setModel);
      expect(await fn(ctx, "openai/gpt-4o")).toBe(true);
      expect(setModel).toHaveBeenCalled();
    });
    it("find가 undefined를 반환하면 false이다", async () => {
      const state = createRouterState();
      const pi = makeFakePi();
      const setModel = vi.fn();
      const find = vi.fn().mockReturnValue(undefined);
      const ctx = makeFakeExtensionContext({
        modelRegistry: makeFakeRegistry({ find }),
      });
      const fn = createTryFallbackByRef(pi, state, setModel);
      expect(await fn(ctx, "openai/gpt")).toBe(false);
    });
    it("find가 예외를 던지면 false이다", async () => {
      const state = createRouterState();
      const pi = makeFakePi();
      const setModel = vi.fn();
      const find = vi.fn().mockImplementation(() => {
        throw new Error("fail");
      });
      const ctx = makeFakeExtensionContext({
        modelRegistry: makeFakeRegistry({ find }),
      });
      const fn = createTryFallbackByRef(pi, state, setModel);
      expect(await fn(ctx, "openai/gpt")).toBe(false);
    });
    it("setModel이 false를 반환하면 false이다", async () => {
      const state = createRouterState();
      const pi = makeFakePi();
      const setModel = vi.fn().mockResolvedValue(false);
      const find = vi.fn().mockReturnValue(makeFakeModel());
      const ctx = makeFakeExtensionContext({
        modelRegistry: makeFakeRegistry({ find }),
      });
      const fn = createTryFallbackByRef(pi, state, setModel);
      expect(await fn(ctx, "openai/gpt")).toBe(false);
    });
  });

  describe("createTryRestoreFallback 함수", () => {
    it("lastNonRouterModel을 먼저 사용한다", async () => {
      const state = createRouterState();
      state.lastNonRouterModel = "openai/gpt";
      const tryFallbackByRef = vi.fn().mockResolvedValue(true);
      const fn = createTryRestoreFallback(state, tryFallbackByRef);
      expect(await fn(makeFakeExtensionContext())).toBe(true);
      expect(tryFallbackByRef).toHaveBeenCalledWith(expect.anything(), "openai/gpt");
    });
    it("anyModel로 폴백한다", async () => {
      const state = createRouterState();
      state.lastNonRouterModel = undefined;
      const tryFallbackByRef = vi.fn().mockResolvedValue(true);
      const getAnyModel = vi.fn().mockReturnValue(makeFakeModel({ provider: "openai", id: "gpt" }));
      const fn = createTryRestoreFallback(state, tryFallbackByRef, getAnyModel);
      expect(await fn(makeFakeExtensionContext())).toBe(true);
      expect(tryFallbackByRef).toHaveBeenCalledWith(expect.anything(), "openai/gpt");
    });
    it("anyModel이 undefined를 반환하면 false이다", async () => {
      const state = createRouterState();
      const tryFallbackByRef = vi.fn();
      const getAnyModel = vi.fn().mockReturnValue(undefined);
      const fn = createTryRestoreFallback(state, tryFallbackByRef, getAnyModel);
      expect(await fn(makeFakeExtensionContext())).toBe(false);
    });
    it("tryFallbackByRef가 false이면 anyModel도 false이다", async () => {
      const state = createRouterState();
      state.lastNonRouterModel = "openai/gpt";
      const tryFallbackByRef = vi.fn().mockResolvedValue(false);
      const getAnyModel = vi.fn().mockReturnValue(makeFakeModel({ provider: "a", id: "b" }));
      const fn = createTryRestoreFallback(state, tryFallbackByRef, getAnyModel);
      // first call with lastNonRouterModel returns false, second with anyModel also false
      tryFallbackByRef.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      expect(await fn(makeFakeExtensionContext())).toBe(false);
    });
    it("getAnyModel 예외를 처리한다", async () => {
      const state = createRouterState();
      const tryFallbackByRef = vi.fn();
      const getAnyModel = vi.fn().mockImplementation(() => {
        throw new Error("fail");
      });
      const fn = createTryRestoreFallback(state, tryFallbackByRef, getAnyModel);
      expect(await fn(makeFakeExtensionContext())).toBe(false);
    });
  });

  describe("createEnsureValidActiveRouterProfile 함수", () => {
    it("router provider가 아니면 반환한다", async () => {
      const state = createRouterState();
      const fn = createEnsureValidActiveRouterProfile(state, vi.fn());
      const notify = vi.fn();
      const ctx = makeFakeExtensionContext({
        model: makeFakeModel({ provider: "openai", id: "gpt" }),
        ui: makeFakeUi({ notify }),
      });
      await fn(ctx);
      expect(notify).not.toHaveBeenCalled();
    });
    it("model이 없으면 반환한다", async () => {
      const state = createRouterState();
      const fn = createEnsureValidActiveRouterProfile(state, vi.fn());
      await fn(makeFakeExtensionContext({ model: undefined }));
      // should return early, no notify
    });
    it("유효한 profile이다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: {} } };
      const fn = createEnsureValidActiveRouterProfile(state, vi.fn());
      const ctx = makeFakeExtensionContext({
        model: makeFakeModel({ provider: "router", id: "balanced" }),
        ui: makeFakeUi(),
      });
      await fn(ctx);
      expect(state.selectedProfile).toBe("balanced");
      expect(state.routerEnabled).toBe(true);
    });
    it("유효하지 않은 profile은 폴백 성공 시 처리한다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} };
      const tryRestoreFallback = vi.fn().mockResolvedValue(true);
      const fn = createEnsureValidActiveRouterProfile(state, tryRestoreFallback);
      const notify = vi.fn();
      const ctx = makeFakeExtensionContext({
        model: makeFakeModel({ provider: "router", id: "unknown" }),
        ui: makeFakeUi({ notify }),
      });
      await fn(ctx);
      expect(state.routerEnabled).toBe(false);
      expect(state.selectedProfile).toBeUndefined();
      expect(tryRestoreFallback).toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("no longer configured"),
        "warning",
      );
    });
    it("유효하지 않은 profile은 폴백 실패 시 처리한다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} };
      const tryRestoreFallback = vi.fn().mockResolvedValue(false);
      const fn = createEnsureValidActiveRouterProfile(state, tryRestoreFallback);
      const notify = vi.fn();
      const ctx = makeFakeExtensionContext({
        model: makeFakeModel({ provider: "router", id: "unknown" }),
        ui: makeFakeUi({ notify }),
      });
      await fn(ctx);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("no fallback"), "warning");
    });
  });
});
