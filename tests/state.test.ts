/* oxlint-disable */
import { describe, it, expect } from "vitest";
import { isRouterPersistedState, buildPersistedState } from "../src/state";
import type { RoutingDecision } from "../src/types";

describe("state.ts 상태는", () => {
  describe("isRouterPersistedState 영속 상태 검사는", () => {
    it("non-object나 null이면 false를 반환한다", () => {
      expect(isRouterPersistedState(null)).toBe(false);
      expect(isRouterPersistedState("string")).toBe(false);
      expect(isRouterPersistedState(123)).toBe(false);
    });

    it("필수 속성이 없거나 타입이 틀리면 false를 반환한다", () => {
      expect(isRouterPersistedState({ enabled: true })).toBe(false);
      expect(
        isRouterPersistedState({
          enabled: "yes",
          selectedProfile: "p",
          timestamp: 123,
        }),
      ).toBe(false);
    });

    it("유효한 persisted state 객체이면 true를 반환한다", () => {
      const state = {
        enabled: true,
        selectedProfile: "balanced",
        timestamp: Date.now(),
      };
      expect(isRouterPersistedState(state)).toBe(true);
    });
  });

  describe("buildPersistedState 영속 상태 생성은", () => {
    it("인터페이스 요구사항에 맞는 state 객체를 생성한다", () => {
      const decision: RoutingDecision = {
        profile: "balanced",
        tier: "high",
        targetProvider: "google",
        targetModelId: "gemini-2.5-pro",
        targetLabel: "google/gemini-2.5-pro",
        reasoning: "Rules matched",
        thinking: "high",
        timestamp: Date.now(),
      };

      const state = buildPersistedState(
        true,
        "balanced",
        true,
        [decision],
        decision,
        "openai/gpt-4o",
        0.0045,
      );

      expect(state.enabled).toBe(true);
      expect(state.selectedProfile).toBe("balanced");
      expect(state.debugEnabled).toBe(true);
      expect(state.debugHistory).toEqual([decision]);
      expect(state.lastDecision).toEqual(decision);
      expect(state.lastNonRouterModel).toBe("openai/gpt-4o");
      expect(state.accumulatedCost).toBe(0.0045);
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it("undefined selectedProfile을 처리한다", () => {
      const state = buildPersistedState(false, undefined, false, [], undefined, undefined, 0);
      expect(state.selectedProfile).toBe("");
    });
  });
});
