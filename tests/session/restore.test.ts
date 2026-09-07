import { describe, expect, it, vi } from "vitest";
import {
  applySavedState,
  delay,
  extractSavedState,
  restoreStateFromSession,
} from "../../src/session/restore";
import { createRouterState } from "../../src/state/create";
import type { CustomSessionEntry } from "../../src/types";

describe("session/restore 모듈", () => {
  describe("delay 함수", () => {
    it("ms 후에 resolve된다", async () => {
      const start = Date.now();
      await delay(10);
      expect(Date.now() - start).toBeGreaterThanOrEqual(5);
    });
  });

  describe("extractSavedState 함수", () => {
    it("빈 배열이면 undefined이다", () => expect(extractSavedState([])).toBeUndefined());
    it("custom이 아니면 필터링한다", () =>
      expect(
        extractSavedState([{ type: "other", customType: "router-state", data: {} } as any]),
      ).toBeUndefined());
    it("router-state가 아닌 customType은 필터링한다", () =>
      expect(
        extractSavedState([{ type: "custom", customType: "other", data: {} } as any]),
      ).toBeUndefined());
    it("마지막 저장 값을 찾는다", () => {
      const data1 = { enabled: true, selectedProfile: "a", timestamp: 1 };
      const data2 = { enabled: false, selectedProfile: "b", timestamp: 2 };
      const entries = [
        { type: "custom", customType: "router-state", data: data1 },
        { type: "custom", customType: "router-state", data: data2 },
      ] as unknown as CustomSessionEntry[];
      expect(extractSavedState(entries)).toBe(data2);
    });
    it("유효하지 않은 저장 값은 무시한다", () => {
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
    it("전부 유효하지 않으면 undefined를 반환한다", () => {
      const entries = [
        { type: "custom", customType: "router-state", data: { enabled: "yes" } },
      ] as unknown as CustomSessionEntry[];
      expect(extractSavedState(entries)).toBeUndefined();
    });
  });

  describe("applySavedState 함수", () => {
    it("debugHistory 슬라이스와 함께 적용한다", () => {
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

    it("없는 선택 필드를 처리한다", () => {
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

    it("알 수 없는 profile을 처리한다", () => {
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

  describe("restoreStateFromSession 함수", () => {
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

    it("router model 복원에 성공한다", async () => {
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

    it("non-router model을 처리한다", async () => {
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

    it("model이 없으면 처리한다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const ctx = makeCtx({ model: undefined });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(state.routerEnabled).toBe(false);
    });

    it("savedState가 있으면 적용한다", async () => {
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

    it("debugHistory 없는 savedState를 처리한다", async () => {
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

    it("setModelInternally 실패를 처리한다", async () => {
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

    it("routerModel을 찾지 못하면 처리한다", async () => {
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

    it("routerEnabled가 아닐 때를 처리한다", async () => {
      const state = createRouterState();
      state.currentConfig = { profiles: {} } as any;
      const ctx = makeCtx({ model: { provider: "openai", id: "gpt-4o" } });
      const actions = makeActions();
      const helpers = makeHelpers();
      await restoreStateFromSession(ctx, state, helpers, actions);
      expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
    });

    it("selectedProfile이 undefined일 때를 처리한다", async () => {
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
