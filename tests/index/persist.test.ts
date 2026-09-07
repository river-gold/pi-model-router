import { describe, expect, it, vi } from "vitest";
import { createPersistState, createRecordDebugDecision } from "../../src/index/persist";
import { createRouterState } from "../../src/state/create";

describe("index/persist 모듈", () => {
  describe("createRecordDebugDecision 함수", () => {
    it("추가하고 MAX_DEBUG_HISTORY까지 잘라낸다", () => {
      const state = createRouterState();
      state.debugHistory = Array.from(
        { length: 20 },
        (_, i) => ({ profile: "p", tier: "high", reasoning: "r", timestamp: i }) as any,
      );
      const fn = createRecordDebugDecision(state);
      fn({ profile: "p", tier: "high", reasoning: "new", timestamp: 999 } as any);
      expect(state.debugHistory.length).toBe(12);
      expect(state.debugHistory[state.debugHistory.length - 1].timestamp).toBe(999);
    });

    it("단일 항목을 추가한다", () => {
      const state = createRouterState();
      const fn = createRecordDebugDecision(state);
      const d = { profile: "p", tier: "high", reasoning: "r", timestamp: 1 } as any;
      fn(d);
      expect(state.debugHistory).toEqual([d]);
    });
  });

  describe("createPersistState 함수", () => {
    it("저장하고 스냅샷을 업데이트한다", () => {
      const state = createRouterState();
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      expect(pi.appendEntry).toHaveBeenCalledWith(
        "router-state",
        expect.objectContaining({ enabled: true }),
      );
      expect(state.lastPersistedSnapshot).toBeDefined();
    });

    it("동일한 스냅샷은 중복 제거한다", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      const calls = pi.appendEntry.mock.calls.length;
      fn();
      expect(pi.appendEntry.mock.calls.length).toBe(calls);
    });

    it("appendEntry 예외를 처리한다", () => {
      const state = createRouterState();
      const pi = {
        appendEntry: vi.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      } as any;
      const fn = createPersistState(pi, state);
      expect(() => fn()).not.toThrow();
    });

    it("timestamp 0인 lastDecision과 debugHistory를 처리한다", () => {
      const state = createRouterState();
      const decision = {
        profile: "balanced",
        tier: "high",
        reasoning: "r",
        timestamp: 123,
        targetProvider: "openai",
        targetModelId: "gpt",
        targetLabel: "openai/gpt",
      } as any;
      state.lastDecision = decision;
      state.debugHistory = [decision];
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      expect(pi.appendEntry).toHaveBeenCalled();
      const snapshot = JSON.parse(state.lastPersistedSnapshot!);
      expect(snapshot.lastDecision.timestamp).toBe(0);
      expect(snapshot.debugHistory[0].timestamp).toBe(0);
    });

    it("lastDecision이 undefined인 경우를 처리한다", () => {
      const state = createRouterState();
      state.lastDecision = undefined;
      state.debugHistory = [];
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      const snapshot = JSON.parse(state.lastPersistedSnapshot!);
      expect(snapshot.lastDecision).toBeUndefined();
    });
  });
});
