import type { Context } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildRoutingDecision,
  decideRouting,
  resolveAvailableTier,
  thinkingToTier,
} from "../src/routing";
import type { Router, RouterTier } from "../src/types";

const unknownTier: RouterTier = JSON.parse('"unknown"');

describe("routing.ts 라우팅은", () => {
  describe("thinkingToTier 변환은", () => {
    it("thinking 레벨을 tier에 매핑한다", () => {
      expect(thinkingToTier("max")).toBe("max");
      expect(thinkingToTier("xhigh")).toBe("xhigh");
      expect(thinkingToTier("high")).toBe("high");
      expect(thinkingToTier("medium")).toBe("medium");
      expect(thinkingToTier("low")).toBe("low");
      expect(thinkingToTier("minimal")).toBe("minimal");
      expect(thinkingToTier("off")).toBe("minimal");
    });
  });
  describe("resolveAvailableTier 사용 가능 티어는", () => {
    const _router: Router = {
      medium: { models: ["openai/gpt-4o"] },
    };

    it("사용 가능하면 preferred를 반환한다", () => {
      expect(
        resolveAvailableTier({ high: { models: ["a"] }, medium: { models: ["b"] } }, "high"),
      ).toBe("high");
    });

    it("preferred가 없으면 상위로 fallback한다", () => {
      expect(resolveAvailableTier({ high: { models: ["a"] } }, "low")).toBe("high");
    });

    it("상위에서 못 찾으면 하위로 fallback한다", () => {
      expect(resolveAvailableTier({ low: { models: ["a"] } }, "medium")).toBe("low");
    });

    it("minimal이 없으면 low로 fallback한다", () => {
      expect(
        resolveAvailableTier({ low: { models: ["a"] }, medium: { models: ["b"] } }, "minimal"),
      ).toBe("low");
    });

    it("router이 비어 있으면 preferred를 반환한다 (fallback이 최종 반환을 처리한다)", () => {
      expect(resolveAvailableTier({}, "medium")).toBe("medium");
    });

    it("router이 비어 있고 preferred가 max이면 preferred를 반환한다 (양쪽 루프 불일치를 처리한다)", () => {
      expect(resolveAvailableTier({}, "max")).toBe("max");
    });

    it("router이 비어 있고 preferred가 minimal이면 preferred를 반환한다", () => {
      expect(resolveAvailableTier({}, "minimal")).toBe("minimal");
    });

    it("startIdx -1을 전체 순서 상위 fallback으로 처리한다", () => {
      const router: Router = {
        medium: { models: ["openai/gpt-4o"] },
      };
      expect(resolveAvailableTier(router, unknownTier)).toBe("medium");
    });

    it("startIdx -1과 빈 router을 처리한다 (양쪽 루프가 비어 있는 경우를 처리한다)", () => {
      expect(resolveAvailableTier({}, unknownTier)).toBe(unknownTier);
    });

    it("minimal만 사용 가능하면 minimal로 하위 fallback한다", () => {
      expect(resolveAvailableTier({ minimal: { models: ["a"] } }, "max")).toBe("minimal");
    });
  });

  describe("buildRoutingDecision 결정 생성은", () => {
    const router: Router = {
      high: { models: ["openai/gpt-4o-pro"], effort: "high" },
    };

    it("올바른 decision 객체를 생성한다", () => {
      const decision = buildRoutingDecision("balanced", router, "high", "Reasoning string");
      expect(decision.router).toBe("balanced");
      expect(decision.tier).toBe("high");
      expect(decision.targetProvider).toBe("openai");
      expect(decision.targetModelId).toBe("gpt-4o-pro");
      expect(decision.targetLabel).toBe("openai/gpt-4o-pro");
      expect(decision.effort).toBe("high");
      expect(decision.reasoning).toBe("Reasoning string");
    });

    it("tier가 router에 없으면 throw한다", () => {
      expect(() => buildRoutingDecision("balanced", router, "medium", "Reason")).toThrow();
    });
  });

  describe("decideRouting 라우팅 결정은", () => {
    const router: Router = {
      high: { models: ["openai/gpt-4o"], resolvedContextWindow: 100 },
      medium: { models: ["openai/gpt-4o-mini"], resolvedContextWindow: 100 },
      low: { models: ["openai/gpt-4o-micro"], resolvedContextWindow: 100 },
    };

    it("항상 medium을 반환한다", () => {
      const ctx: Context = {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      };
      const d = decideRouting(ctx, "p", router, undefined);
      expect(d.tier).toBe("medium");
      expect(d.reasoning).toContain("Defaulted to medium");
    });

    it("이전 decision과 무관하게 항상 medium을 반환한다", () => {
      const ctx: Context = {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      };
      const prev = buildRoutingDecision("p", router, "high", "prev");
      const d = decideRouting(ctx, "p", router, prev);
      expect(d.tier).toBe("medium");
    });

    it("medium tier가 없으면 fallback한다 (resolvedTier !== tier 분기를 처리한다)", () => {
      const fallbackRouter: Router = {
        low: { models: ["openai/gpt-4o-micro"] },
      };
      const ctx: Context = {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      };
      const d = decideRouting(ctx, "p", fallbackRouter, undefined);
      expect(d.tier).toBe("low");
      expect(d.reasoning).toContain("Resolved from medium to low");
    });

    it("high만 사용 가능하면 상위로 fallback한다", () => {
      const highOnly: Router = {
        high: { models: ["openai/gpt-4o"] },
      };
      const ctx: Context = {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      };
      const d = decideRouting(ctx, "p", highOnly, undefined);
      expect(d.tier).toBe("high");
      expect(d.reasoning).toContain("Resolved from medium to high");
    });
  });
});
