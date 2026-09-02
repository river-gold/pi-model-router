import { describe, expect, it, vi } from "vitest";
import {
  applySavedState,
  delay,
  extractSavedState,
  restoreStateFromSession,
} from "../../src/session/restore";
import { createRouterState } from "../../src/state/create";
import type { CustomSessionEntry } from "../../src/types";

describe("session/restore", () => {
  describe("delay", () => {
    it("resolves after ms", async () => {
      const start = Date.now();
      await delay(10);
      expect(Date.now() - start).toBeGreaterThanOrEqual(5);
    });
  });

  describe("extractSavedState", () => {
    it("empty -> undefined", () => expect(extractSavedState([])).toBeUndefined());
    it("filters non-custom", () =>
      expect(
        extractSavedState([{ type: "other", customType: "router-state", data: {} } as any]),
      ).toBeUndefined());
    it("filters customType not router-state", () =>
      expect(
        extractSavedState([{ type: "custom", customType: "other", data: {} } as any]),
      ).toBeUndefined());
    it("finds last persisted", () => {
      const data1 = { enabled: true, selectedProfile: "a", timestamp: 1 };
      const data2 = { enabled: false, selectedProfile: "b", timestamp: 2 };
      const entries = [
        { type: "custom", customType: "router-state", data: data1 },
        { type: "custom", customType: "router-state", data: data2 },
      ] as unknown as CustomSessionEntry[];
      expect(extractSavedState(entries)).toBe(data2);
    });
    it("ignores invalid persisted", () => {
      const entries = [
        { type: "custom", customType: "router-state", data: { enabled: true } }, // missing timestamp
        {
          type: "custom",
          customType: "router-state",
          data: { enabled: true, selectedProfile: "a", timestamp: 1 },
        },
      ] as unknown as CustomSessionEntry[];
      expect(extractSavedState(entries)).toEqual({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
      });
    });
    it("returns undefined when all invalid", () => {
      const entries = [
        { type: "custom", customType: "router-state", data: { enabled: "yes" } },
      ] as unknown as CustomSessionEntry[];
      expect(extractSavedState(entries)).toBeUndefined();
    });
  });

  describe("applySavedState", () => {
    it("applies with debugHistory slice", () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt"] } } } } as any;
      const savedState: any = {
        enabled: true,
        selectedProfile: "balanced",
        debugEnabled: true,
        debugHistory: Array.from(
          { length: 20 },
          (_, i) => ({ profile: "p", tier: "high", reasoning: "r", timestamp: i }) as any,
        ),
        lastNonRouterModel: "openai/gpt-4o",
        accumulatedCost: 5,
        lastDecision: { profile: "balanced", tier: "high" } as any,
        timestamp: Date.now(),
      };
      applySavedState(state, savedState);
      expect(state.routerEnabled).toBe(true);
      expect(state.selectedProfile).toBe("balanced");
      expect(state.debugEnabled).toBe(true);
      expect(state.debugHistory.length).toBeLessThanOrEqual(12); // MAX_DEBUG_HISTORY
      expect(state.lastNonRouterModel).toBe("openai/gpt-4o");
      expect(state.accumulatedCost).toBe(5);
      expect(state.lastDecision).toBe(savedState.lastDecision);
    });

    it("handles missing optional fields", () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      state.debugEnabled = false;
      state.lastNonRouterModel = "orig";
      state.accumulatedCost = 10;
      const savedState: any = {
        enabled: false,
        selectedProfile: "missing",
        timestamp: Date.now(),
        // no debugEnabled, debugHistory, lastNonRouterModel, accumulatedCost, lastDecision
      };
      applySavedState(state, savedState);
      expect(state.debugEnabled).toBe(false); // stays false
      expect(state.debugHistory).toEqual([]);
      expect(state.lastNonRouterModel).toBe("orig");
      expect(state.accumulatedCost).toBe(0);
      expect(state.lastDecision).toBeUndefined();
    });

    it("handles unknown profile", () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const savedState: any = {
        enabled: true,
        selectedProfile: "unknown",
        timestamp: Date.now(),
      };
      applySavedState(state, savedState);
      expect(state.selectedProfile).toBeUndefined();
    });
  });

  describe("restoreStateFromSession", () => {
    const makeCtx = (over: any = {}): any => ({
      cwd: "/cwd",
      modelRegistry: {
        find: vi.fn((p: string, id: string) =>
          p === "router" && id === "balanced" ? ({ provider: p, id } as any) : undefined,
        ),
      },
      model: { provider: "router", id: "balanced" },
      sessionManager: { getBranch: () => [] },
      ui: {
        notify: vi.fn(),
        setHiddenThinkingLabel: vi.fn(),
        setStatus: vi.fn(),
        theme: { fg: (_: string, t: string) => t },
      },
      ...over,
    });

    const makeActions = () => ({
      reloadConfig: vi.fn(),
      ensureValidActiveRouterProfile: vi.fn().mockResolvedValue(undefined),
    });

    const makeHelpers = (over: any = {}) => ({
      setModelInternally: vi.fn().mockResolvedValue(true),
      persistState: vi.fn(),
      ...over,
    });

    it("restores with router model success", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt"] } } } } as any;
      const ctx = makeCtx();
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(actions.reloadConfig).toHaveBeenCalledWith(ctx);
      expect(state.routerEnabled).toBe(true);
      expect(helpers.persistState).toHaveBeenCalled();
      expect(helpers.setModelInternally).toHaveBeenCalled();
    });

    it("handles non-router model", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt"] } } } } as any;
      const ctx = makeCtx({ model: { provider: "openai", id: "gpt-4o" } });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(state.routerEnabled).toBe(false);
      expect(state.lastNonRouterModel).toBe("openai/gpt-4o");
      expect(helpers.persistState).toHaveBeenCalled();
    });

    it("handles no model", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const ctx = makeCtx({ model: undefined });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(state.routerEnabled).toBe(false);
    });

    it("applies savedState when present", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt"] } } } } as any;
      const savedData = {
        enabled: true,
        selectedProfile: "balanced",
        debugEnabled: true,
        debugHistory: [],
        timestamp: Date.now(),
      };
      const ctx = makeCtx({
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: "router-state", data: savedData }],
        },
      });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(state.debugEnabled).toBe(true);
    });

    it("handles savedState without debugHistory", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const savedData = { enabled: true, selectedProfile: "balanced", timestamp: Date.now() };
      const ctx = makeCtx({
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: "router-state", data: savedData }],
        },
      });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(state.debugHistory).toEqual([]);
    });

    it("handles setModelInternally failure", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt"] } } } } as any;
      const ctx = makeCtx();
      const actions = makeActions();
      const helpers = makeHelpers({ setModelInternally: vi.fn().mockResolvedValue(false) });
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(state.routerEnabled).toBe(false);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to restore"),
        "warning",
      );
    });

    it("handles routerModel not found", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt"] } } } } as any;
      const ctx = makeCtx({
        modelRegistry: { find: vi.fn(() => undefined) },
      });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Unable to restore"),
        "warning",
      );
      expect(state.routerEnabled).toBe(false);
      expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
    });

    it("handles not routerEnabled", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const ctx = makeCtx({ model: { provider: "openai", id: "gpt-4o" } });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
    });

    it("handles selectedProfile undefined", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const ctx = makeCtx({ model: { provider: "router", id: "unknown" } });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      // should still call persist and updateStatus, and setHiddenThinkingLabel because not enabled or no profile
      expect(helpers.persistState).toHaveBeenCalled();
    });
  });
});
