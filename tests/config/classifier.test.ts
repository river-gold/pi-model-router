import { describe, expect, it } from "vitest";
import {
  normalizeClassifierConfig,
  normalizeClassifierModels,
  resolveClassifierRefModels,
  resolveEffectiveClassifier,
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
    it("단일 문자열 형식은 거부함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels("openai/gpt-4o", w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/Expected an array/);
      const w2: string[] = [];
      expect(normalizeClassifierModels("@cheap#low#off", w2, "ctx")).toBeUndefined();
      expect(w2[0]).toMatch(/Expected an array/);
    });
    it("숫자/객체 입력은 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(123, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/Expected an array/);
      const w2: string[] = [];
      expect(normalizeClassifierModels({ ref: "cheap#low#off" }, w2, "ctx")).toBeUndefined();
      expect(w2[0]).toMatch(/Expected an array/);
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
    it("@@typesafe/<model> 항목을 정규화함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["@@typesafe/jev"], w, "ctx")).toEqual([
        { typesafe: true, model: "jev" },
      ]);
      expect(normalizeClassifierModels(["  @@typesafe/jev-latest  "], w, "ctx")).toEqual([
        { typesafe: true, model: "jev-latest" },
      ]);
      expect(w).toEqual([]);
    });
    it("model이 없는 @@typesafe 항목은 warning 남기고 건너뜀을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["@@typesafe/", "@@typesafe/  "], w, "ctx")).toBeUndefined();
      expect(w.length).toBe(2);
      expect(w[0]).toMatch(/expected "@@typesafe\/<model>"/);
    });
    it("@로 시작하는 항목은 논리적 참조로 유지함을 검증함", () => {
      for (const ref of ["cheap#medium", "cheap#low", "cheap#low#off"]) {
        const w: string[] = [];
        expect(normalizeClassifierModels([`@${ref}`], w, "ctx")).toEqual([{ ref }]);
        expect(w).toEqual([]);
      }
    });
    it("@ 참조 앞뒤 공백을 제거함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["  @ cheap#low#off  "], w, "ctx")).toEqual([
        { ref: "cheap#low#off" },
      ]);
      expect(w).toEqual([]);
    });
    it("잘못된 @ 참조는 warning 남기고 건너뜀을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["@p#bad", "@#high", "@p#h#bogus"], w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid ctx\[0\] "@p#bad"/);
    });
    it("배열 안의 @ 참조와 일반 모델을 함께 처리함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["@cheap#low#off", "openai/a#low"], w, "ctx")).toEqual([
        { ref: "cheap#low#off" },
        { model: "openai/a", thinking: "low" },
      ]);
      expect(w).toEqual([]);
    });
    it("배열 안의 잘못된 항목은 warning 남기고 건너뜀을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["@cheap#low#off", { ref: "x" }, 1], w, "ctx")).toEqual([
        { ref: "cheap#low#off" },
      ]);
      expect(w.length).toBe(2);
      expect(w[0]).toMatch(/expected "provider\/model#thinking"/);
    });
    it("모든 종류의 항목 순서를 유지함을 검증함", () => {
      const w: string[] = [];
      expect(
        normalizeClassifierModels(["@@typesafe/jev", "@base#low#off", "openai/a#low"], w, "ctx"),
      ).toEqual([
        { typesafe: true, model: "jev" },
        { ref: "base#low#off" },
        { model: "openai/a", thinking: "low" },
      ]);
      expect(w).toEqual([]);
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
    it("TypeSafe 항목은 체인에 그대로 남음을 검증함", () => {
      const profile: RouterProfile = {
        classifierModels: [{ typesafe: true, model: "jev" }],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(profile, [{ typesafe: true, model: "jev" }]);
      expect(r.source).toBe("profile → global → low tier");
      expect(r.classifiers).toEqual([
        { typesafe: true, model: "jev", source: "profile" },
        { typesafe: true, model: "jev", source: "global" },
        { model: "google/gemini", thinking: "low", source: "low tier" },
      ]);
    });
    it("항목 순서가 그대로 체인 순서가 됨을 검증함", () => {
      const profile: RouterProfile = {
        classifierModels: [
          { typesafe: true, model: "jev" },
          { model: "openai/a", thinking: "low" },
          { ref: "base#low#off" },
        ],
      };
      const profiles: Record<string, RouterProfile> = {
        base: { medium: { models: ["base/m"] } },
      };
      const r = resolveEffectiveClassifier(profile, undefined, profiles);
      expect(r.classifiers).toEqual([
        { typesafe: true, model: "jev", source: "profile" },
        { model: "openai/a", thinking: "low", source: "profile" },
        { model: "base/m", thinking: "off", source: "profile" },
      ]);
    });
  });

  describe("resolveClassifierRefModels 동작을 검증함", () => {
    const refProfiles = (): Record<string, RouterProfile> => ({
      cheap: {
        low: { models: ["c/m1", "c/m2#high"], thinking: "max" },
        medium: { models: ["c/m3"] },
      },
    });
    it("profile#tier#effort는 지정 tier 모델에 effort를 지정함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#low#off", refProfiles())).toEqual([
        { model: "c/m1", thinking: "off" },
        { model: "c/m2", thinking: "off" },
      ]);
    });
    it("profile#tier는 해당 tier를 사용함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#medium", refProfiles())).toEqual([
        { model: "c/m3", thinking: undefined },
      ]);
    });
    it("profile#tier#effort는 지정 tier에 effort를 지정함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#medium#low", refProfiles())).toEqual([
        { model: "c/m3", thinking: "low" },
      ]);
    });
    it("대상 tier가 없으면 가까운 tier로 폴백함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        cheap: { high: { models: ["c/h"] } },
      };
      expect(resolveClassifierRefModels("cheap#low#off", profiles)).toEqual([
        { model: "c/h", thinking: "off" },
      ]);
    });
    it("형식 오류 ref는 undefined를 검증함", () => {
      expect(resolveClassifierRefModels("bad#invalidtier#off", refProfiles())).toBeUndefined();
      expect(resolveClassifierRefModels("badformat", refProfiles())).toBeUndefined();
    });
    it("없는 profile은 undefined를 검증함", () => {
      expect(resolveClassifierRefModels("ghost#low#off", refProfiles())).toBeUndefined();
    });
    it("해석 불가 ref는 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = { auto: {} };
      expect(resolveClassifierRefModels("ghost#high", profiles)).toBeUndefined();
    });
  });

  describe("resolveEffectiveClassifier ref 확장을 검증함", () => {
    const refProfiles = (): Record<string, RouterProfile> => ({
      auto: {
        classifierModels: [{ ref: "cheap#low#off" }],
        low: { models: ["auto/a#low"] },
      },
      cheap: {
        low: { models: ["c/m1", "c/m2#high"], thinking: "max" },
        medium: { models: ["c/m3"] },
      },
    });
    it("profile ref를 펼쳐 source profile로 묶음을 검증함", () => {
      const profiles = refProfiles();
      const r = resolveEffectiveClassifier(profiles.auto!, undefined, profiles);
      expect(r.classifiers).toEqual([
        { model: "c/m1", thinking: "off", source: "profile" },
        { model: "c/m2", thinking: "off", source: "profile" },
        { model: "auto/a", thinking: "low", source: "low tier" },
      ]);
      expect(r.source).toBe("profile → low tier");
    });
    it("global ref를 펼침을 검증함", () => {
      const profiles = refProfiles();
      const r = resolveEffectiveClassifier({}, [{ ref: "cheap#medium" }], profiles);
      expect(r.classifiers).toEqual([{ model: "c/m3", thinking: undefined, source: "global" }]);
      expect(r.source).toBe("global");
    });
    it("profiles 없이는 ref를 펼치지 않음을 검증함", () => {
      const profile: RouterProfile = { classifierModels: [{ ref: "cheap#low#off" }] };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toBeUndefined();
      expect(r.source).toBe("none");
    });
    it("해석 불가 ref는 건너뜀을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: {
          classifierModels: [{ ref: "ghost#low#off" }],
          low: { models: ["auto/a#low"] },
        },
      };
      const r = resolveEffectiveClassifier(profiles.auto!, undefined, profiles);
      expect(r.classifiers).toEqual([{ model: "auto/a", thinking: "low", source: "low tier" }]);
      expect(r.source).toBe("low tier");
    });
    it("profile 배열과 global ref를 함께 펼침을 검증함", () => {
      const profiles = refProfiles();
      const profile: RouterProfile = {
        classifierModels: [{ model: "openai/a", thinking: "low" as const }],
      };
      const r = resolveEffectiveClassifier(profile, [{ ref: "cheap#low#off" }], profiles);
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
            classifierModels: ["@cheap#low#off"],
            low: { models: ["auto/a"] },
          },
          cheap: { low: { models: ["c/m"] } },
        },
      });
      expect(warnings).toEqual([]);
      expect(config.profiles.auto!.classifierModels).toEqual([{ ref: "cheap#low#off" }]);
    });
    it("global ref가 논리적 참조로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        classifierModels: ["@cheap#low"],
        profiles: { cheap: { low: { models: ["c/m"] } } },
      });
      expect(warnings).toEqual([]);
      expect(config.classifierModels).toEqual([{ ref: "cheap#low" }]);
    });
    it("@@typesafe 항목이 체인에 유지됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        classifierModels: ["@@typesafe/jev", "openai/a#low"],
        profiles: { auto: { medium: { models: ["openai/m"] } } },
      });
      expect(warnings).toEqual([]);
      expect(config.classifierModels).toEqual([
        { typesafe: true, model: "jev" },
        { model: "openai/a", thinking: "low" },
      ]);
      const r = resolveEffectiveClassifier(config.profiles.auto!, config.classifierModels);
      expect(r.classifiers).toEqual([
        { typesafe: true, model: "jev", source: "global" },
        { model: "openai/a", thinking: "low", source: "global" },
      ]);
    });
    it("무효한 ref는 warning 남기고 비움함을 검증함", () => {
      const { warnings } = normalizeConfig({
        profiles: {
          auto: {
            classifierModels: ["@p#bad"],
            low: { models: ["auto/a"] },
          },
        },
      });
      expect(warnings.some((w) => w.includes("Invalid"))).toBe(true);
    });
  });
});
