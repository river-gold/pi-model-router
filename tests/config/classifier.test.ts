import { describe, expect, it } from "vitest";
import {
  normalizeClassifierConfig,
  normalizeClassifierModels,
  resolveClassifierRefModels,
  resolveEffectiveClassifier,
} from "../../src/config/classifier";
import { normalizeConfig } from "../../src/config/normalize";
import type { Router } from "../../src/types";

describe("classifier를 검증함", () => {
  describe("normalizeClassifierConfig 동작을 검증함", () => {
    it("effort 없는 유효한 문자열을 처리함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o", w, "classifierModels")).toEqual({
        model: "openai/gpt-4o",
        effort: undefined,
      });
      expect(w).toEqual([]);
    });
    it("effort 있는 유효한 문자열을 처리함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o#high", w, "classifierModels")).toEqual({
        model: "openai/gpt-4o",
        effort: "high",
      });
    });
    it("앞뒤 공백을 제거함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig(" openai/gpt-4o#low ", w, "ctx")).toEqual({
        model: "openai/gpt-4o",
        effort: "low",
      });
    });
    it("잘못된 ref는 warning 남기고 undefined 반환함을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("invalid", w, "classifierModels")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid classifierModels/);
    });
    it("잘못된 effort는 warning 남김을 검증함", () => {
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
        { model: "openai/gpt-4o", effort: "high" },
        { model: "google/gemini", effort: "low" },
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
        { model: "openai/a", effort: "low" },
      ]);
      expect(w).toEqual([]);
    });
    it("배열 안의 잘못된 항목은 warning 남기고 건너뜀을 검증함", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["@cheap#low#off", { ref: "x" }, 1], w, "ctx")).toEqual([
        { ref: "cheap#low#off" },
      ]);
      expect(w.length).toBe(2);
      expect(w[0]).toMatch(/expected "provider\/model#effort"/);
    });
    it("모든 종류의 항목 순서를 유지함을 검증함", () => {
      const w: string[] = [];
      expect(
        normalizeClassifierModels(["@@typesafe/jev", "@base#low#off", "openai/a#low"], w, "ctx"),
      ).toEqual([
        { typesafe: true, model: "jev" },
        { ref: "base#low#off" },
        { model: "openai/a", effort: "low" },
      ]);
      expect(w).toEqual([]);
    });
  });

  describe("resolveEffectiveClassifier 동작을 검증함", () => {
    it("router만 있는 경우를 처리함을 검증함", () => {
      const router = { classifierModels: [{ model: "openai/gpt-4o", effort: "low" as const }] };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.classifiers).toEqual([
        { model: "openai/gpt-4o", effort: "low", source: "router" },
      ]);
      expect(r.source).toBe("router");
    });
    it("global만 있는 경우를 처리함을 검증함", () => {
      const router: Router = {};
      const r = resolveEffectiveClassifier(router, [
        { model: "openai/gpt-4o", effort: "high" as const },
      ]);
      expect(r.classifiers).toEqual([
        { model: "openai/gpt-4o", effort: "high", source: "global" },
      ]);
      expect(r.source).toBe("global");
    });
    it("low만 있는 경우를 처리함을 검증함", () => {
      const router: Router = { low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.classifiers).toEqual([
        { model: "google/gemini", effort: "low", source: "low tier" },
      ]);
      expect(r.source).toBe("low tier");
    });
    it("router+global+low 조합을 처리함을 검증함", () => {
      const router: Router = {
        classifierModels: [{ model: "openai/a", effort: "low" as const }],
        low: { models: ["google/gemini#high"] },
      };
      const global = [{ model: "openai/b", effort: "medium" as const }];
      const r = resolveEffectiveClassifier(router, global);
      expect(r.classifiers).toEqual([
        { model: "openai/a", effort: "low", source: "router" },
        { model: "openai/b", effort: "medium", source: "global" },
        { model: "google/gemini", effort: "high", source: "low tier" },
      ]);
      expect(r.source).toBe("router → global → low tier");
    });
    it("router+low 조합을 처리함을 검증함", () => {
      const router: Router = {
        classifierModels: [{ model: "openai/gpt-4o", effort: "low" as const }],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.source).toBe("router → low tier");
      expect(r.classifiers?.length).toBe(2);
    });
    it("없으면 classifiers는 undefined, source는 none임을 검증함", () => {
      const router: Router = { high: { models: ["openai/gpt-4o"] } };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.classifiers).toBeUndefined();
      expect(r.source).toBe("none");
    });
    it("여러 모델과 effort가 있는 low를 처리함을 검증함", () => {
      const router: Router = {
        low: { models: ["google/gemini#high", "openai/gpt-4o-mini#off"] },
      };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.classifiers).toEqual([
        { model: "google/gemini", effort: "high", source: "low tier" },
        { model: "openai/gpt-4o-mini", effort: "off", source: "low tier" },
      ]);
    });
    it("빈 low는 무시함을 검증함", () => {
      const router: Router = { low: { models: [] } };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.classifiers).toBeUndefined();
    });
    it("빈 router classifier는 무시함을 검증함", () => {
      const router: Router = {
        classifierModels: [],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.source).toBe("low tier");
    });
    it("빈 global은 무시함을 검증함", () => {
      const router: Router = { low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(router, []);
      expect(r.source).toBe("low tier");
    });
    it("TypeSafe 항목은 체인에 그대로 남음을 검증함", () => {
      const router: Router = {
        classifierModels: [{ typesafe: true, model: "jev" }],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(router, [{ typesafe: true, model: "jev" }]);
      expect(r.source).toBe("router → global → low tier");
      expect(r.classifiers).toEqual([
        { typesafe: true, model: "jev", source: "router" },
        { typesafe: true, model: "jev", source: "global" },
        { model: "google/gemini", effort: "low", source: "low tier" },
      ]);
    });
    it("항목 순서가 그대로 체인 순서가 됨을 검증함", () => {
      const router: Router = {
        classifierModels: [
          { typesafe: true, model: "jev" },
          { model: "openai/a", effort: "low" },
          { ref: "base#low#off" },
        ],
      };
      const routers: Record<string, Router> = {
        base: { medium: { models: ["base/m"] } },
      };
      const r = resolveEffectiveClassifier(router, undefined, routers);
      expect(r.classifiers).toEqual([
        { typesafe: true, model: "jev", source: "router" },
        { model: "openai/a", effort: "low", source: "router" },
        { model: "base/m", effort: "off", source: "router" },
      ]);
    });
  });

  describe("resolveClassifierRefModels 동작을 검증함", () => {
    const refRouters = (): Record<string, Router> => ({
      cheap: {
        low: { models: ["c/m1", "c/m2#high"], effort: "max" },
        medium: { models: ["c/m3"] },
      },
    });
    it("router#tier#effort는 지정 tier 모델에 effort를 지정함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#low#off", refRouters())).toEqual([
        { model: "c/m1", effort: "off" },
        { model: "c/m2", effort: "off" },
      ]);
    });
    it("router#tier는 해당 tier를 사용함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#medium", refRouters())).toEqual([
        { model: "c/m3", effort: undefined },
      ]);
    });
    it("router#tier#effort는 지정 tier에 effort를 지정함을 검증함", () => {
      expect(resolveClassifierRefModels("cheap#medium#low", refRouters())).toEqual([
        { model: "c/m3", effort: "low" },
      ]);
    });
    it("대상 tier가 없으면 가까운 tier로 폴백함을 검증함", () => {
      const routers: Record<string, Router> = {
        cheap: { high: { models: ["c/h"] } },
      };
      expect(resolveClassifierRefModels("cheap#low#off", routers)).toEqual([
        { model: "c/h", effort: "off" },
      ]);
    });
    it("형식 오류 ref는 undefined를 검증함", () => {
      expect(resolveClassifierRefModels("bad#invalidtier#off", refRouters())).toBeUndefined();
      expect(resolveClassifierRefModels("badformat", refRouters())).toBeUndefined();
    });
    it("없는 router은 undefined를 검증함", () => {
      expect(resolveClassifierRefModels("ghost#low#off", refRouters())).toBeUndefined();
    });
    it("해석 불가 ref는 undefined를 검증함", () => {
      const routers: Record<string, Router> = { auto: {} };
      expect(resolveClassifierRefModels("ghost#high", routers)).toBeUndefined();
    });
  });

  describe("resolveEffectiveClassifier ref 확장을 검증함", () => {
    const refRouters = (): Record<string, Router> => ({
      auto: {
        classifierModels: [{ ref: "cheap#low#off" }],
        low: { models: ["auto/a#low"] },
      },
      cheap: {
        low: { models: ["c/m1", "c/m2#high"], effort: "max" },
        medium: { models: ["c/m3"] },
      },
    });
    it("router ref를 펼쳐 source router로 묶음을 검증함", () => {
      const routers = refRouters();
      const r = resolveEffectiveClassifier(routers.auto!, undefined, routers);
      expect(r.classifiers).toEqual([
        { model: "c/m1", effort: "off", source: "router" },
        { model: "c/m2", effort: "off", source: "router" },
        { model: "auto/a", effort: "low", source: "low tier" },
      ]);
      expect(r.source).toBe("router → low tier");
    });
    it("global ref를 펼침을 검증함", () => {
      const routers = refRouters();
      const r = resolveEffectiveClassifier({}, [{ ref: "cheap#medium" }], routers);
      expect(r.classifiers).toEqual([{ model: "c/m3", effort: undefined, source: "global" }]);
      expect(r.source).toBe("global");
    });
    it("routers 없이는 ref를 펼치지 않음을 검증함", () => {
      const router: Router = { classifierModels: [{ ref: "cheap#low#off" }] };
      const r = resolveEffectiveClassifier(router, undefined);
      expect(r.classifiers).toBeUndefined();
      expect(r.source).toBe("none");
    });
    it("해석 불가 ref는 건너뜀을 검증함", () => {
      const routers: Record<string, Router> = {
        auto: {
          classifierModels: [{ ref: "ghost#low#off" }],
          low: { models: ["auto/a#low"] },
        },
      };
      const r = resolveEffectiveClassifier(routers.auto!, undefined, routers);
      expect(r.classifiers).toEqual([{ model: "auto/a", effort: "low", source: "low tier" }]);
      expect(r.source).toBe("low tier");
    });
    it("router 배열과 global ref를 함께 펼침을 검증함", () => {
      const routers = refRouters();
      const router: Router = {
        classifierModels: [{ model: "openai/a", effort: "low" as const }],
      };
      const r = resolveEffectiveClassifier(router, [{ ref: "cheap#low#off" }], routers);
      expect(r.classifiers).toEqual([
        { model: "openai/a", effort: "low", source: "router" },
        { model: "c/m1", effort: "off", source: "global" },
        { model: "c/m2", effort: "off", source: "global" },
      ]);
      expect(r.source).toBe("router → global");
    });
  });

  describe("normalizeConfig classifierModels ref 통합을 검증함", () => {
    it("router ref가 논리적 참조로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        routers: {
          auto: {
            classifierModels: ["@cheap#low#off"],
            low: { models: ["auto/a"] },
          },
          cheap: { low: { models: ["c/m"] } },
        },
      });
      expect(warnings).toEqual([]);
      expect(config.routers.auto!.classifierModels).toEqual([{ ref: "cheap#low#off" }]);
    });
    it("global ref가 논리적 참조로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        classifierModels: ["@cheap#low"],
        routers: { cheap: { low: { models: ["c/m"] } } },
      });
      expect(warnings).toEqual([]);
      expect(config.classifierModels).toEqual([{ ref: "cheap#low" }]);
    });
    it("@@typesafe 항목이 체인에 유지됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        classifierModels: ["@@typesafe/jev", "openai/a#low"],
        routers: { auto: { medium: { models: ["openai/m"] } } },
      });
      expect(warnings).toEqual([]);
      expect(config.classifierModels).toEqual([
        { typesafe: true, model: "jev" },
        { model: "openai/a", effort: "low" },
      ]);
      const r = resolveEffectiveClassifier(config.routers.auto!, config.classifierModels);
      expect(r.classifiers).toEqual([
        { typesafe: true, model: "jev", source: "global" },
        { model: "openai/a", effort: "low", source: "global" },
      ]);
    });
    it("무효한 ref는 warning 남기고 비움함을 검증함", () => {
      const { warnings } = normalizeConfig({
        routers: {
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
