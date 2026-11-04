import { describe, expect, it, vi } from "vitest";
import { createPersistState, createRecordDebugDecision } from "../../src/index/persist";
import { createRouterState } from "../../src/state/create";
import { makeFakeDecision, makeFakePi } from "../helpers";

describe("index/persist 모듈", () => {
  describe("createRecordDebugDecision 함수", () => {
    it("추가하고 MAX_DEBUG_HISTORY까지 잘라낸다", () => {
      const state = createRouterState();
      state.debugHistory = Array.from({ length: 20 }, (_, i) =>
        makeFakeDecision({ reasoning: "r", timestamp: i }),
      );
      const fn = createRecordDebugDecision(state);
      fn(makeFakeDecision({ reasoning: "new", timestamp: 999 }));
      expect(state.debugHistory.length).toBe(12);
      const last = state.debugHistory[state.debugHistory.length - 1];
      if (last === undefined) expect.unreachable();
      expect(last.timestamp).toBe(999);
    });

    it("단일 항목을 추가한다", () => {
      const state = createRouterState();
      const fn = createRecordDebugDecision(state);
      const d = makeFakeDecision({ reasoning: "r", timestamp: 1 });
      fn(d);
      expect(state.debugHistory).toEqual([d]);
    });
  });

  describe("createPersistState 함수", () => {
    it("저장하고 스냅샷을 업데이트한다", () => {
      const state = createRouterState();
      state.routerEnabled = true;
      state.selectedRouter = "balanced";
      const appendEntry = vi.fn();
      const pi = makeFakePi({ appendEntry });
      const fn = createPersistState(pi, state);
      fn();
      expect(appendEntry).toHaveBeenCalledWith(
        "router-state",
        expect.objectContaining({ enabled: true }),
      );
      expect(state.lastPersistedSnapshot).toBeDefined();
    });

    it("동일한 스냅샷은 중복 제거한다", () => {
      const state = createRouterState();
      const appendEntry = vi.fn();
      const pi = makeFakePi({ appendEntry });
      const fn = createPersistState(pi, state);
      fn();
      const calls = appendEntry.mock.calls.length;
      fn();
      expect(appendEntry.mock.calls.length).toBe(calls);
    });

    it("appendEntry 예외를 처리한다", () => {
      const state = createRouterState();
      const appendEntry = vi.fn().mockImplementation(() => {
        throw new Error("fail");
      });
      const pi = makeFakePi({ appendEntry });
      const fn = createPersistState(pi, state);
      expect(() => fn()).not.toThrow();
    });

    it("timestamp 0인 lastDecision과 debugHistory를 처리한다", () => {
      const state = createRouterState();
      const decision = makeFakeDecision({
        reasoning: "r",
        timestamp: 123,
        targetProvider: "openai",
        targetModelId: "gpt",
        targetLabel: "openai/gpt",
      });
      state.lastDecision = decision;
      state.debugHistory = [decision];
      const appendEntry = vi.fn();
      const pi = makeFakePi({ appendEntry });
      const fn = createPersistState(pi, state);
      fn();
      expect(appendEntry).toHaveBeenCalled();
      if (state.lastPersistedSnapshot === undefined) expect.unreachable();
      const snapshot: unknown = JSON.parse(state.lastPersistedSnapshot);
      if (typeof snapshot !== "object" || snapshot === null) expect.unreachable();
      if (!("lastDecision" in snapshot) || !("debugHistory" in snapshot)) expect.unreachable();
      const snapDecision = snapshot.lastDecision;
      const snapHistory = snapshot.debugHistory;
      if (typeof snapDecision !== "object" || snapDecision === null) expect.unreachable();
      if (!("timestamp" in snapDecision)) expect.unreachable();
      expect(snapDecision.timestamp).toBe(0);
      if (!Array.isArray(snapHistory)) expect.unreachable();
      const first = snapHistory[0];
      if (typeof first !== "object" || first === null) expect.unreachable();
      if (!("timestamp" in first)) expect.unreachable();
      expect(first.timestamp).toBe(0);
    });

    it("lastDecision이 undefined인 경우를 처리한다", () => {
      const state = createRouterState();
      state.lastDecision = undefined;
      state.debugHistory = [];
      const appendEntry = vi.fn();
      const pi = makeFakePi({ appendEntry });
      const fn = createPersistState(pi, state);
      fn();
      if (state.lastPersistedSnapshot === undefined) expect.unreachable();
      const snapshot: unknown = JSON.parse(state.lastPersistedSnapshot);
      if (typeof snapshot !== "object" || snapshot === null) expect.unreachable();
      const snapLast = "lastDecision" in snapshot ? snapshot.lastDecision : undefined;
      expect(snapLast).toBeUndefined();
    });
  });
});
