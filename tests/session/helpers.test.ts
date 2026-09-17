import { describe, expect, it, vi } from "vitest";
import {
  createPersistState,
  createSessionHelpers,
  createSetModelInternally,
} from "../../src/session/helpers";
import { createRouterState } from "../../src/state/create";
import { makeFakeDecision, makeFakeModel } from "../helpers";

describe("session/helpers 모듈", () => {
  describe("createSetModelInternally 함수", () => {
    it("증가·감소 후 true를 반환한다", async () => {
      const state = createRouterState();
      const pi = { setModel: vi.fn().mockResolvedValue(true) };
      const fn = createSetModelInternally(pi, state);
      const result = await fn(makeFakeModel({ provider: "openai", id: "gpt-4o" }));
      expect(result).toBe(true);
      expect(state.isInternalModelSwitch).toBe(0);
      expect(pi.setModel).toHaveBeenCalled();
    });

    it("예외 발생 시 false를 반환한다", async () => {
      const state = createRouterState();
      const pi = { setModel: vi.fn().mockRejectedValue(new Error("fail")) };
      const fn = createSetModelInternally(pi, state);
      const result = await fn(makeFakeModel());
      expect(result).toBe(false);
      expect(state.isInternalModelSwitch).toBe(0);
    });

    it("setModel이 false를 반환해도 처리한다", async () => {
      const state = createRouterState();
      const pi = { setModel: vi.fn().mockResolvedValue(false) };
      const fn = createSetModelInternally(pi, state);
      expect(await fn(makeFakeModel())).toBe(false);
    });
  });

  describe("createPersistState 함수", () => {
    it("저장하고 스냅샷을 업데이트한다", () => {
      const state = createRouterState();
      state.routerEnabled = true;
      state.selectedRouter = "balanced";
      const pi = { appendEntry: vi.fn() };
      const fn = createPersistState(pi, state);
      fn();
      expect(pi.appendEntry).toHaveBeenCalledWith(
        "router-state",
        expect.objectContaining({ enabled: true }),
      );
      expect(state.lastPersistedSnapshot).toBeDefined();
    });

    it("lastDecision과 debugHistory를 포함해 저장한다", () => {
      const state = createRouterState();
      const decision = makeFakeDecision({ timestamp: Date.now() });
      state.lastDecision = decision;
      state.debugHistory = [decision];
      state.lastPersistedSnapshot = undefined;
      const pi = { appendEntry: vi.fn() };
      const fn = createPersistState(pi, state);
      fn();
      expect(pi.appendEntry).toHaveBeenCalled();
      const snapshot = JSON.parse(state.lastPersistedSnapshot!);
      expect(snapshot.lastDecision.timestamp).toBe(0);
      expect(snapshot.debugHistory[0].timestamp).toBe(0);
    });

    it("동일한 스냅샷은 중복 제거한다", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn() };
      const fn = createPersistState(pi, state);
      fn();
      const firstCalls = pi.appendEntry.mock.calls.length;
      fn();
      expect(pi.appendEntry.mock.calls.length).toBe(firstCalls);
    });

    it("appendEntry 예외를 처리한다", () => {
      const state = createRouterState();
      const pi = {
        appendEntry: vi.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      };
      const fn = createPersistState(pi, state);
      // should not throw
      expect(() => fn()).not.toThrow();
      // snapshot not updated? actually it tries, catches, returns, so lastPersistedSnapshot stays undefined? Let's check implementation: it checks snapshot === lastPersistedSnapshot, then try, catch return. So snapshot not updated on throw.
      expect(pi.appendEntry).toHaveBeenCalled();
    });

    it("변경 후 다른 state를 처리한다", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn() };
      const fn = createPersistState(pi, state);
      fn();
      const snapshot1 = state.lastPersistedSnapshot;
      state.routerEnabled = true;
      fn();
      expect(state.lastPersistedSnapshot).not.toBe(snapshot1);
    });
  });

  describe("createSessionHelpers 함수", () => {
    it("두 helper를 모두 반환한다", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn(), setModel: vi.fn().mockResolvedValue(true) };
      const helpers = createSessionHelpers(pi, state);
      expect(typeof helpers.setModelInternally).toBe("function");
      expect(typeof helpers.persistState).toBe("function");
    });
  });
});
