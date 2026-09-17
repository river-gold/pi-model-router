import { describe, expect, it } from "vitest";
import {
  normalizeClassifierConfig,
  normalizeClassifierModels,
  resolveClassifierRefModels,
  resolveEffectiveClassifier,
  resolveTypesafeClassifier,
} from "../../src/config/classifier";
import { normalizeConfig } from "../../src/config/normalize";
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
    it("TYPESAFE_CLASSIFIER 문자열은 TypeSafe 참조로 정규화함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels("TYPESAFE_CLASSIFIER", w, "ctx")).toEqual({
        typesafe: true,
      });
      expect(normalizeClassifierModels("  TYPESAFE_CLASSIFIER  ", w, "ctx")).toEqual({
        typesafe: true,
      });
      expect(w).toEqual([]);
    });
    it("잘못된 number 타입은 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(123, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string, array of strings, or/);
    });
    it("잘못된 object 타입은 warning 남김을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels({}, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string, array of strings, or/);
    });
    it("ref object는 논리적 참조로 유지함을 검증함", () => {
      for (const ref of ["cheap##off", "cheap#low", "cheap#low##off"]) {
        const w: string[] = [];
        expect(normalizeClassifierModels({ ref }, w, "ctx")).toEqual({ ref });
        expect(w).toEqual([]);
      }
    });
    it("ref 앞뒤 공백을 제거함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels({ ref: " cheap##off " }, w, "ctx")).toEqual({
        ref: "cheap##off",
      });
      expect(w).toEqual([]);
    });
    it("잘못된 ref object는 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels({ ref: "badformat" }, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid ctx ref/);
    });
    it("ref가 문자열이 아니면 warning 남김을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels({ ref: 123 }, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string, array of strings, or/);
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
    it("TypeSafe 참조는 LLM 분류기 후보에서 제외함을 검증함", () => {
      const profile: RouterProfile = {
        classifierModels: { typesafe: true },
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(profile, { typesafe: true });
      expect(r.source).toBe("low tier");
      expect(r.classifiers).toEqual([
        { model: "google/gemini", thinking: "low", source: "low tier" },
      ]);
    });
  });

  describe("resolveTypesafeClassifier 동작을 검증함", () => {
    it("profile이 TypeSafe 참조면 true임을 검증함", () => {
      expect(resolveTypesafeClassifier({ classifierModels: { typesafe: true } }, undefined)).toBe(
        true,
      );
    });
    it("profile이 없고 global이 TypeSafe 참조면 true임을 검증함", () => {
      expect(resolveTypesafeClassifier({}, { typesafe: true })).toBe(true);
    });
    it("profile 설정이 있으면 global TypeSafe 참조를 무시함을 검증함", () => {
      expect(
        resolveTypesafeClassifier(
          { classifierModels: [{ model: "openai/a" }] },
          { typesafe: true },
        ),
      ).toBe(false);
    });
    it("TypeSafe 참조가 없으면 false임을 검증함", () => {
      expect(resolveTypesafeClassifier({}, undefined)).toBe(false);
      expect(resolveTypesafeClassifier({}, [{ model: "openai/a" }])).toBe(false);
      expect(resolveTypesafeClassifier({}, { ref: "cheap#low" })).toBe(false);
      expect(resolveTypesafeClassifier({}, { ref: 123 })).toBe(false);
    });
  });

  describe("resolveClassifierRefModels 동작을 검증함", () => {
    const refProfiles = (): Record<string, RouterProfile> => ({
      cheap: {
        low: { models: ["c/m1", "c/m2#high"], thinking: "max" },
        medium: { models: ["c/m3"] },
      },
    });
    it("profile##effort는 low tier 모델에 effort를 지정함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap##off", refProfiles())).toEqual([
        { model: "c/m1", thinking: "off" },
        { model: "c/m2", thinking: "off" },
      ]);
    });
    it("profile#tier는 해당 tier를 사용함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#medium", refProfiles())).toEqual([
        { model: "c/m3", thinking: undefined },
      ]);
    });
    it("profile#tier##effort는 지정 tier에 effort를 지정함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#medium##low", refProfiles())).toEqual([
        { model: "c/m3", thinking: "low" },
      ]);
    });
    it("대상 tier가 없으면 가까운 tier로 폴백함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        cheap: { high: { models: ["c/h"] } },
      };
      expect(resolveClassifierRefModels("cheap##off", profiles)).toEqual([
        { model: "c/h", thinking: "off" },
      ]);
    });
    it("형식 오류 ref는 undefined를 검증함", () => {
      expect(resolveClassifierRefModels("badformat", refProfiles())).toBeUndefined();
    });
    it("없는 profile은 undefined를 검증함", () => {
      expect(resolveClassifierRefModels("ghost##off", refProfiles())).toBeUndefined();
    });
    it("해석 불가 ref는 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = { auto: {} };
      expect(resolveClassifierRefModels("ghost#high", profiles)).toBeUndefined();
    });
  });

  describe("resolveEffectiveClassifier ref 확장을 검증함", () => {
    const refProfiles = (): Record<string, RouterProfile> => ({
      auto: {
        classifierModels: { ref: "cheap##off" },
        low: { models: ["auto/a#low"] },
      },
      cheap: {
        low: { models: ["c/m1", "c/m2#high"], thinking: "max" },
        medium: { models: ["c/m3"] },
      },
    });
    it("profile ref를 펼쳐 source profile로 묶음을 검증함", () => {
      const profiles = refProfiles();
      const r = resolveEffectiveClassifier(profiles.auto!, undefined, profiles, "auto");
      expect(r.classifiers).toEqual([
        { model: "c/m1", thinking: "off", source: "profile" },
        { model: "c/m2", thinking: "off", source: "profile" },
        { model: "auto/a", thinking: "low", source: "low tier" },
      ]);
      expect(r.source).toBe("profile → low tier");
    });
    it("global ref를 펼침을 검증함", () => {
      const profiles = refProfiles();
      const r = resolveEffectiveClassifier({}, { ref: "cheap#medium" }, profiles, "auto");
      expect(r.classifiers).toEqual([{ model: "c/m3", thinking: undefined, source: "global" }]);
      expect(r.source).toBe("global");
    });
    it("profiles 없이는 ref를 펼치지 않음을 검증함", () => {
      const profile: RouterProfile = { classifierModels: { ref: "cheap##off" } };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toBeUndefined();
      expect(r.source).toBe("none");
    });
    it("해석 불가 ref는 건너뜀을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: {
          classifierModels: { ref: "ghost##off" },
          low: { models: ["auto/a#low"] },
        },
      };
      const r = resolveEffectiveClassifier(profiles.auto!, undefined, profiles, "auto");
      expect(r.classifiers).toEqual([{ model: "auto/a", thinking: "low", source: "low tier" }]);
      expect(r.source).toBe("low tier");
    });
    it("profile 배열과 global ref를 함께 펼침을 검증함", () => {
      const profiles = refProfiles();
      const profile: RouterProfile = {
        classifierModels: [{ model: "openai/a", thinking: "low" as const }],
      };
      const r = resolveEffectiveClassifier(profile, { ref: "cheap##off" }, profiles, "auto");
      expect(r.classifiers).toEqual([
        { model: "openai/a", thinking: "low", source: "profile" },
        { model: "c/m1", thinking: "off", source: "global" },
        { model: "c/m2", thinking: "off", source: "global" },
      ]);
      expect(r.source).toBe("profile → global");
    });
  });

  describe("normalizeConfig classifierModels ref 통합을 검증함", () => {
    it("profile ref가 논리적 참조로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: {
            classifierModels: { ref: "cheap##off" },
            low: { models: ["auto/a"] },
          },
          cheap: { low: { models: ["c/m"] } },
        },
      });
      expect(warnings).toEqual([]);
      expect(config.profiles.auto!.classifierModels).toEqual({ ref: "cheap##off" });
    });
    it("global ref가 논리적 참조로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        classifierModels: { ref: "cheap#low" },
        profiles: { cheap: { low: { models: ["c/m"] } } },
      });
      expect(warnings).toEqual([]);
      expect(config.classifierModels).toEqual({ ref: "cheap#low" });
    });
    it("무효한 ref는 warning 남기고 비움함을 검증함", () => {
      const { warnings } = normalizeConfig({
        profiles: {
          auto: {
            classifierModels: { ref: "badformat" },
            low: { models: ["auto/a"] },
          },
        },
      });
      expect(warnings.some((w) => w.includes("Invalid"))).toBe(true);
    });
  });
});
