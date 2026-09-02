import { describe, expect, it } from "vitest";
import { mergeTier, normalizeTierConfig } from "../../src/config/tier";

describe("tier", () => {
  describe("mergeTier", () => {
    it("both undefined -> undefined", () =>
      expect(mergeTier(undefined, undefined)).toBeUndefined());
    it("existing only -> existing", () => {
      const e = { models: ["openai/gpt-4o"] };
      expect(mergeTier(e, undefined)).toBe(e);
    });
    it("next only -> next", () => {
      const n = { models: ["openai/gpt-4o"] };
      expect(mergeTier(undefined, n as any)).toEqual(n);
    });
    it("both -> merged with next overriding", () => {
      const e = { models: ["openai/gpt-4o"], contextWindow: 1000 } as any;
      const n = { models: ["google/gemini"] } as any;
      expect(mergeTier(e, n)).toEqual({ models: ["google/gemini"], contextWindow: 1000 });
    });
    it("both with overlap -> next wins", () => {
      const e = { models: ["openai/a"], maxTokens: 100 } as any;
      const n = { models: ["openai/b"], maxTokens: 200 } as any;
      expect(mergeTier(e, n)).toEqual({ models: ["openai/b"], maxTokens: 200 });
    });
  });

  describe("normalizeTierConfig", () => {
    it("not object -> undefined", () => {
      expect(normalizeTierConfig("string", "p", "high", [])).toBeUndefined();
      expect(normalizeTierConfig(null, "p", "high", [])).toBeUndefined();
      expect(normalizeTierConfig([], "p", "high", [])).toBeUndefined();
    });
    it("missing models -> warning and undefined", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({}, "p", "high", w)).toBeUndefined();
      expect(w[0]).toMatch(/missing "models"/);
    });
    it("empty array -> warning", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({ models: [] }, "p", "high", w)).toBeUndefined();
      expect(w[0]).toMatch(/missing "models"/);
    });
    it("models not array -> warning", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({ models: "not-array" }, "p", "high", w)).toBeUndefined();
    });
    it("invalid model entries: non-string, empty, whitespace", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: [123, "", "   ", null] }, "p", "high", w);
      expect(r).toBeUndefined();
      expect(w.filter((x) => x.includes("Invalid model entry")).length).toBe(4);
    });
    it("invalid model ref -> warning and filtered", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: ["invalid", "openai/gpt-4o"] }, "p", "high", w);
      expect(r?.models).toEqual(["openai/gpt-4o"]);
      expect(w.some((x) => x.includes("Invalid model"))).toBe(true);
    });
    it("all invalid -> disabled", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: ["bad", "also/bad#invalid"] }, "p", "high", w);
      expect(r).toBeUndefined();
      expect(w.some((x) => x.includes("no valid models"))).toBe(true);
    });
    it("valid with thinking extracted", () => {
      const w: string[] = [];
      const r = normalizeTierConfig({ models: ["openai/gpt-4o#high"] }, "p", "high", w);
      expect(r?.thinking).toBe("high");
      expect(r?.models).toEqual(["openai/gpt-4o#high"]);
    });
    it("valid without thinking", () => {
      const w: string[] = [];
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w)?.thinking,
      ).toBeUndefined();
    });
    it("with contextWindow valid", () => {
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
    it("with contextWindow invalid (negative, zero, non-number)", () => {
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
    it("with maxTokens valid/invalid", () => {
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
    it("with reasoning true/false/non-boolean", () => {
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
    it("multiple models with trimming and valid", () => {
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
