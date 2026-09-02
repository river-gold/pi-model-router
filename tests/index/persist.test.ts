import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPersistState, createRecordDebugDecision } from "../../src/index/persist";
import { createRouterState } from "../../src/state/create";
import type { RouterState } from "../../src/state/create";

describe("index/persist", () => {
  describe("createRecordDebugDecision", () => {
    it("appends and slices to MAX_DEBUG_HISTORY", () => {
      const state = createRouterState();
      state.debugHistory = Array.from({ length: 20 }, (_, i) => ({ profile: "p", tier: "high", reasoning: "r", timestamp: i } as any));
      const fn = createRecordDebugDecision(state);
      fn({ profile: "p", tier: "high", reasoning: "new", timestamp: 999 } as any);
      expect(state.debugHistory.length).toBe(12);
      expect(state.debugHistory[state.debugHistory.length - 1].timestamp).toBe(999);
    });

    it("appends single", () => {
      const state = createRouterState();
      const fn = createRecordDebugDecision(state);
      const d = { profile: "p", tier: "high", reasoning: "r", timestamp: 1 } as any;
      fn(d);
      expect(state.debugHistory).toEqual([d]);
    });
  });

  describe("createPersistState", () => {
    it("persists and updates snapshot", () => {
      const state = createRouterState();
      state.routerEnabled = true;
      state.selectedProfile = "balanced";
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      expect(pi.appendEntry).toHaveBeenCalledWith("router-state", expect.objectContaining({ enabled: true }));
      expect(state.lastPersistedSnapshot).toBeDefined();
    });

    it("dedupes identical snapshot", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      const calls = pi.appendEntry.mock.calls.length;
      fn();
      expect(pi.appendEntry.mock.calls.length).toBe(calls);
    });

    it("handles appendEntry throw", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn().mockImplementation(() => { throw new Error("fail"); }) } as any;
      const fn = createPersistState(pi, state);
      expect(() => fn()).not.toThrow();
    });

    it("handles lastDecision and debugHistory with timestamp 0", () => {
      const state = createRouterState();
      const decision = { profile: "balanced", tier: "high", reasoning: "r", timestamp: 123, targetProvider: "openai", targetModelId: "gpt", targetLabel: "openai/gpt" } as any;
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

    it("handles undefined lastDecision", () => {
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
