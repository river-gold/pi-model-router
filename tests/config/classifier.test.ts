import { describe, expect, it } from "vitest";
import {
  normalizeClassifierConfig,
  normalizeClassifierModels,
  resolveEffectiveClassifier,
} from "../../src/config/classifier";
import type { RouterProfile } from "../../src/types";

describe("classifier를 검증함", () => {
  describe("normalizeClassifierConfig 동작을 검증함", () => {
    it("thinking 없는 유효한 문자열을 처리함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o", w, "classifierModels")).toEqual({
        model: "openai/gpt-4o",
        thinking: undefined,
      });
      expect(w).toEqual([]);
    });
    it("thinking 있는 유효한 문자열을 처리함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o#high", w, "classifierModels")).toEqual({
        model: "openai/gpt-4o",
        thinking: "high",
      });
    });
    it("앞뒤 공백을 제거함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig(" openai/gpt-4o#low ", w, "ctx")).toEqual({
        model: "openai/gpt-4o",
        thinking: "low",
      });
    });
    it("잘못된 ref는 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("invalid", w, "classifierModels")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid classifierModels/);
    });
    it("잘못된 thinking은 warning 남김을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o#bad", w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid ctx/);
    });
    it("빈 문자열은 warning 없이 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("", w, "ctx")).toBeUndefined();
      expect(w).toEqual([]);
    });
    it("공백만 있는 문자열은 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("   ", w, "ctx")).toBeUndefined();
      expect(w).toEqual([]);
    });
    it("non-string 입력은 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig(123, w, "ctx")).toBeUndefined();
      expect(normalizeClassifierConfig(null, w, "ctx")).toBeUndefined();
      expect(normalizeClassifierConfig({}, w, "ctx")).toBeUndefined();
      expect(w).toEqual([]);
    });
  });

  describe("normalizeClassifierModels 동작을 검증함", () => {
    it("undefined 입력은 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(undefined, w, "classifierModels")).toBeUndefined();
      expect(w).toEqual([]);
    });
    it("유효한 문자열은 배열로 변환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels("openai/gpt-4o#low", w, "ctx")).toEqual([
        { model: "openai/gpt-4o", thinking: "low" },
      ]);
    });
    it("잘못된 문자열은 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels("bad", w, "ctx")).toBeUndefined();
      expect(w.length).toBe(1);
    });
    it("유효/무효 혼합 배열을 처리함을 검증함", () => {
      const w: string[] = [];
      const r = normalizeClassifierModels(
        ["openai/gpt-4o#high", "invalid", "google/gemini#low"],
        w,
        "ctx",
      );
      expect(r).toEqual([
        { model: "openai/gpt-4o", thinking: "high" },
        { model: "google/gemini", thinking: "low" },
      ]);
      expect(w.length).toBe(1);
    });
    it("빈 배열은 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels([], w, "ctx")).toBeUndefined();
    });
    it("모두 무효한 배열은 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["bad", "also/bad#invalid"], w, "ctx")).toBeUndefined();
    });
    it("잘못된 number 타입은 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(123, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string or array/);
    });
    it("잘못된 object 타입은 warning 남김을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels({}, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string or array/);
    });
  });

  describe("resolveEffectiveClassifier 동작을 검증함", () => {
    it("profile만 있는 경우를 처리함을 검증함", () => {
      const profile = { classifierModels: [{ model: "openai/gpt-4o", thinking: "low" as const }] };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toEqual([
        { model: "openai/gpt-4o", thinking: "low", source: "profile" },
      ]);
      expect(r.source).toBe("profile");
    });
    it("global만 있는 경우를 처리함을 검증함", () => {
      const profile: RouterProfile = {};
      const r = resolveEffectiveClassifier(profile, [
        { model: "openai/gpt-4o", thinking: "high" as const },
      ]);
      expect(r.classifiers).toEqual([
        { model: "openai/gpt-4o", thinking: "high", source: "global" },
      ]);
      expect(r.source).toBe("global");
    });
    it("low만 있는 경우를 처리함을 검증함", () => {
      const profile: RouterProfile = { low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toEqual([
        { model: "google/gemini", thinking: "low", source: "low tier" },
      ]);
      expect(r.source).toBe("low tier");
    });
    it("profile+global+low 조합을 처리함을 검증함", () => {
      const profile: RouterProfile = {
        classifierModels: [{ model: "openai/a", thinking: "low" as const }],
        low: { models: ["google/gemini#high"] },
      };
      const global = [{ model: "openai/b", thinking: "medium" as const }];
      const r = resolveEffectiveClassifier(profile, global);
      expect(r.classifiers).toEqual([
        { model: "openai/a", thinking: "low", source: "profile" },
        { model: "openai/b", thinking: "medium", source: "global" },
        { model: "google/gemini", thinking: "high", source: "low tier" },
      ]);
      expect(r.source).toBe("profile → global → low tier");
    });
    it("profile+low 조합을 처리함을 검증함", () => {
      const profile: RouterProfile = {
        classifierModels: [{ model: "openai/gpt-4o", thinking: "low" as const }],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.source).toBe("profile → low tier");
      expect(r.classifiers?.length).toBe(2);
    });
    it("없으면 classifiers는 undefined, source는 none임을 검증함", () => {
      const profile: RouterProfile = { high: { models: ["openai/gpt-4o"] } };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toBeUndefined();
      expect(r.source).toBe("none");
    });
    it("여러 모델과 thinking이 있는 low를 처리함을 검증함", () => {
      const profile: RouterProfile = {
        low: { models: ["google/gemini#high", "openai/gpt-4o-mini#off"] },
      };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toEqual([
        { model: "google/gemini", thinking: "high", source: "low tier" },
        { model: "openai/gpt-4o-mini", thinking: "off", source: "low tier" },
      ]);
    });
    it("빈 low는 무시함을 검증함", () => {
      const profile: RouterProfile = { low: { models: [] } };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toBeUndefined();
    });
    it("빈 profile classifier는 무시함을 검증함", () => {
      const profile: RouterProfile = {
        classifierModels: [],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.source).toBe("low tier");
    });
    it("빈 global은 무시함을 검증함", () => {
      const profile: RouterProfile = { low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(profile, []);
      expect(r.source).toBe("low tier");
    });
  });
});
