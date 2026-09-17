import { describe, expect, it } from "vitest";
import {
  mergeTier,
  nearbyTierOrder,
  normalizeTierConfig,
  resolveAvailableTier,
} from "../../src/config/tier";
import type { RouterTier } from "../../src/types";

describe("tier를 검증함", () => {
  describe("nearbyTierOrder 순서 규칙을 검증함", () => {
    it("선호 → 위쪽 → 아래쪽 순서를 검증함", () => {
      expect(nearbyTierOrder("medium")).toEqual([
        "medium",
        "high",
        "xhigh",
        "max",
        "low",
        "minimal",
      ]);
    });
    it("resolveAvailableTier와 같은 결과를 검증함", () => {
      const profile: Partial<Record<RouterTier, unknown>> = {
        high: { models: ["a"] },
        low: { models: ["b"] },
      };
      expect(resolveAvailableTier(profile, "medium")).toBe(
        nearbyTierOrder("medium").find((t) => profile[t]),
      );
    });
  });
  describe("mergeTier 동작을 검증함", () => {
    it("둘 다 undefined면 undefined 반환함을 검증함", () =>
      expect(mergeTier(undefined, undefined)).toBeUndefined());
    it("existing만 있으면 existing 반환함을 검증함", () => {
      const e = { models: ["openai/gpt-4o"] };
      expect(mergeTier(e, undefined)).toBe(e);
    });
    it("next만 있으면 next 반환함을 검증함", () => {
      const n = { models: ["openai/gpt-4o"] };
      expect(mergeTier(undefined, n)).toEqual(n);
    });
    it("둘 다 있으면 next가 덮어쓰며 병합함을 검증함", () => {
      const e = { models: ["openai/gpt-4o"], contextWindow: 1000 };
      const n = { models: ["google/gemini"] };
      expect(mergeTier(e, n)).toEqual({ models: ["google/gemini"], contextWindow: 1000 });
    });
    it("겹치면 next가 우선함을 검증함", () => {
      const e = { models: ["openai/a"], maxTokens: 100 };
      const n = { models: ["openai/b"], maxTokens: 200 };
      expect(mergeTier(e, n)).toEqual({ models: ["openai/b"], maxTokens: 200 });
    });
  });

  describe("normalizeTierConfig 동작을 검증함", () => {
    it("제거된 ref 필드는 경고하고 tier를 비활성화함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({ ref: "copilot#high" }, "p", "high", w)).toBeUndefined();
      expect(w[0]).toMatch(/removed "ref"/);
    });
    it("@ 위임 모델 항목은 유효함을 검증함", () => {
      for (const entry of ["@copilot", "@copilot#high", "@copilot#high#off"]) {
        const w: string[] = [];
        expect(normalizeTierConfig({ models: [entry] }, "p", "high", w)?.models).toEqual([entry]);
        expect(w).toEqual([]);
      }
    });
    it("무효한 모델 항목은 warning 남기고 제외함을 검증함", () => {
      for (const entry of ["bad", "@p#bad", "@#high", "@p#h#bogus", "@p#a#b#c"]) {
        const w: string[] = [];
        expect(normalizeTierConfig({ models: [entry] }, "p", "high", w)).toBeUndefined();
        expect(w.some((x) => x.includes("Invalid model"))).toBe(true);
      }
    });
    it("@@typesafe 항목은 classifierModels 전용임을 warning으로 알림을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig(
        { models: ["@@typesafe/jev-latest", "openai/gpt"] },
        "p",
        "high",
        w,
      );
      expect(r?.models).toEqual(["openai/gpt"]);
      expect(w[0]).toContain('"@@typesafe/" entries are only supported in "classifierModels"');
    });
    it("object가 아니면 undefined 반환함을 검증함", () => {
      expect(normalizeTierConfig("string", "p", "high", [])).toBeUndefined();
      expect(normalizeTierConfig(null, "p", "high", [])).toBeUndefined();
      expect(normalizeTierConfig([], "p", "high", [])).toBeUndefined();
    });
    it("models 누락 시 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({}, "p", "high", w)).toBeUndefined();
      expect(w[0]).toMatch(/missing "models"/);
    });
    it("빈 배열이면 warning 남김을 검증함", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({ models: [] }, "p", "high", w)).toBeUndefined();
      expect(w[0]).toMatch(/missing "models"/);
    });
    it("models가 배열이 아니면 warning 남김을 검증함", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({ models: "not-array" }, "p", "high", w)).toBeUndefined();
    });
    it("무효한 모델 항목 non-string, empty, whitespace를 처리함을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: [123, "", "   ", null] }, "p", "high", w);
      expect(r).toBeUndefined();
      expect(w.filter((x) => x.includes("Invalid model entry")).length).toBe(4);
    });
    it("잘못된 model ref는 warning 남기고 제외함을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: ["invalid", "openai/gpt-4o"] }, "p", "high", w);
      expect(r?.models).toEqual(["openai/gpt-4o"]);
      expect(w.some((x) => x.includes("Invalid model"))).toBe(true);
    });
    it("모두 무효하면 비활성화됨을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: ["bad", "also/bad#invalid"] }, "p", "high", w);
      expect(r).toBeUndefined();
      expect(w.some((x) => x.includes("no valid models"))).toBe(true);
    });
    it("모델별 #는 tier 강제값으로 승격하지 않음을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: ["openai/gpt-4o#high"] }, "p", "high", w);
      expect(r?.thinking).toBeUndefined();
      expect(r?.models).toEqual(["openai/gpt-4o#high"]);
    });
    it("thinking 없는 유효한 입력을 처리함을 검증함", () => {
      const w: string[] = [];
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w)?.thinking,
      ).toBeUndefined();
    });
    it("유효한 contextWindow를 처리함을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig(
        { models: ["openai/gpt-4o"], contextWindow: 50000 },
        "p",
        "high",
        w,
      );
      expect(r?.contextWindow).toBe(50000);
      expect(r?.resolvedContextWindow).toBe(50000);
    });
    it("무효한 contextWindow(negative, zero, non-number)를 처리함을 검증함", () => {
      const w: string[] = [];
      const r1 = normalizeTierConfig(
        { models: ["openai/gpt-4o"], contextWindow: -1 },
        "p",
        "high",
        w,
      );
      expect(r1?.contextWindow).toBeUndefined();
      expect(r1?.resolvedContextWindow).toBe(128000);
      const r2 = normalizeTierConfig(
        { models: ["openai/gpt-4o"], contextWindow: 0 },
        "p",
        "high",
        [],
      );
      expect(r2?.contextWindow).toBeUndefined();
      const r3 = normalizeTierConfig(
        { models: ["openai/gpt-4o"], contextWindow: "bad" },
        "p",
        "high",
        [],
      );
      expect(r3?.contextWindow).toBeUndefined();
    });
    it("유효/무효 maxTokens를 처리함을 검증함", () => {
      const w: string[] = [];
      const r1 = normalizeTierConfig(
        { models: ["openai/gpt-4o"], maxTokens: 2000 },
        "p",
        "high",
        w,
      );
      expect(r1?.maxTokens).toBe(2000);
      expect(r1?.resolvedMaxTokens).toBe(2000);
      const r2 = normalizeTierConfig({ models: ["openai/gpt-4o"], maxTokens: -5 }, "p", "high", []);
      expect(r2?.maxTokens).toBeUndefined();
      expect(r2?.resolvedMaxTokens).toBe(16384);
      const r3 = normalizeTierConfig({ models: ["openai/gpt-4o"], maxTokens: 0 }, "p", "high", []);
      expect(r3?.maxTokens).toBeUndefined();
    });
    it("reasoning true/false/non-boolean 값을 처리함을 검증함", () => {
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"], reasoning: true }, "p", "high", [])
          ?.reasoning,
      ).toBe(true);
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"], reasoning: false }, "p", "high", [])
          ?.reasoning,
      ).toBe(false);
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"], reasoning: "yes" }, "p", "high", [])
          ?.reasoning,
      ).toBeUndefined();
    });
    it("프로필 기본 모델을 상속함을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ effort: "max" }, "p", "high", w, [
        "openai/gpt-4o",
        "google/gemini-flash#low",
      ]);
      expect(w).toEqual([]);
      expect(r?.models).toEqual(["openai/gpt-4o", "google/gemini-flash#low"]);
      expect(r?.thinking).toBe("max");
    });
    it("티어 models가 있으면 프로필 기본값보다 우선함을 검증함", () => {
      const r = normalizeTierConfig(
        { models: ["openai/gpt-4o-mini"], effort: "low" },
        "p",
        "low",
        [],
        ["openai/gpt-4o"],
      );
      expect(r?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(r?.thinking).toBe("low");
    });
    it("상속 없이 models 없으면 비활성화됨을 검증함", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({ effort: "high" }, "p", "high", w)).toBeUndefined();
      expect(w[0]).toMatch(/missing "models"/);
    });
    it("공백 제거된 여러 유효 모델을 처리함을 검증함", () => {
      const w: string[] = [];
      const r = normalizeTierConfig(
        { models: ["openai/gpt-4o#high", "google/gemini-1.5-flash#low", "invalid"] },
        "p",
        "high",
        w,
      );
      expect(r?.models).toEqual(["openai/gpt-4o#high", "google/gemini-1.5-flash#low"]);
    });
  });
});
