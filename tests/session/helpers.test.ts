import { describe, expect, it, vi } from "vitest";
import { createPersistState, createSessionHelpers, createSetModelInternally } from "../../src/session/helpers";
import { createRouterState } from "../../src/state/create";
import type { RouterState } from "../../src/state/create";

describe("session/helpers", () => {
  describe("createSetModelInternally", () => {
    it("increments/decrements and returns true", async () => {
      const state = { isInternalModelSwitch: 0 } as RouterState;
      const pi = { setModel: vi.fn().mockResolvedValue(true) } as any;
      const fn = createSetModelInternally(pi, state);
      const result = await fn({ provider: "openai", id: "gpt-4o" } as any);
      expect(result).toBe(true);
      expect(state.isInternalModelSwitch).toBe(0);
      expect(pi.setModel).toHaveBeenCalled();
    });

    it("returns false on throw", async () => {
      const state = { isInternalModelSwitch: 0 } as RouterState;
      const pi = { setModel: vi.fn().mockRejectedValue(new Error("fail")) } as any;
      const fn = createSetModelInternally(pi, state);
      const result = await fn({} as any);
      expect(result).toBe(false);
      expect(state.isInternalModelSwitch).toBe(0);
    });

    it("handles setModel returning false", async () => {
      const state = { isInternalModelSwitch: 0 } as RouterState;
      const pi = { setModel: vi.fn().mockResolvedValue(false) } as any;
      const fn = createSetModelInternally(pi, state);
      expect(await fn({} as any)).toBe(false);
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

    it("persists with lastDecision and debugHistory", () => {
      const state = createRouterState();
      const decision = {
        profile: "balanced",
        tier: "high",
        targetProvider: "openai",
        targetModelId: "gpt",
        targetLabel: "openai/gpt",
        reasoning: "test",
        timestamp: Date.now(),
      } as any;
      state.lastDecision = decision;
      state.debugHistory = [decision];
      state.lastPersistedSnapshot = undefined;
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      expect(pi.appendEntry).toHaveBeenCalled();
      const snapshot = JSON.parse(state.lastPersistedSnapshot!);
      expect(snapshot.lastDecision.timestamp).toBe(0);
      expect(snapshot.debugHistory[0].timestamp).toBe(0);
    });

    it("dedupes identical snapshot", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      const firstCalls = pi.appendEntry.mock.calls.length;
      fn();
      expect(pi.appendEntry.mock.calls.length).toBe(firstCalls);
    });

    it("handles appendEntry throw", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn().mockImplementation(() => { throw new Error("fail"); }) } as any;
      const fn = createPersistState(pi, state);
      // should not throw
      expect(() => fn()).not.toThrow();
      // snapshot not updated? actually it tries, catches, returns, so lastPersistedSnapshot stays undefined? Let's check implementation: it checks snapshot === lastPersistedSnapshot, then try, catch return. So snapshot not updated on throw.
      expect(pi.appendEntry).toHaveBeenCalled();
    });

    it("handles different state after change", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn() } as any;
      const fn = createPersistState(pi, state);
      fn();
      const snapshot1 = state.lastPersistedSnapshot;
      state.routerEnabled = true;
      fn();
      expect(state.lastPersistedSnapshot).not.toBe(snapshot1);
    });
  });

  describe("createSessionHelpers", () => {
    it("returns both helpers", () => {
      const state = createRouterState();
      const pi = { appendEntry: vi.fn(), setModel: vi.fn().mockResolvedValue(true) } as any;
      const helpers = createSessionHelpers(pi, state);
      expect(typeof helpers.setModelInternally).toBe("function");
      expect(typeof helpers.persistState).toBe("function");
    });
  });
});
