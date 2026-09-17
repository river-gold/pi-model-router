import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../src/config/normalize";

describe("normalizeConfig 동작을 검증함", () => {
  it("알 수 없는 최상위 필드에 warning 남김을 검증함", () => {
    const { warnings } = normalizeConfig({
      unknownField: 123,
      profiles: {},
    });
    expect(warnings.some((w) => w.includes('Unknown config field "unknownField"'))).toBe(true);
  });
  it("여러 알 수 없는 필드에 warning 남김을 검증함", () => {
    const { warnings } = normalizeConfig({ a: 1, b: 2, profiles: {} });
    expect(warnings.filter((w) => w.includes("Unknown config field")).length).toBe(2);
  });
  it("debug true/false/non-boolean 값을 처리함을 검증함", () => {
    expect(normalizeConfig({ debug: true, profiles: {} }).config.debug).toBe(true);
    expect(normalizeConfig({ debug: false, profiles: {} }).config.debug).toBe(false);
    expect(normalizeConfig({ debug: "yes", profiles: {} }).config.debug).toBe(false);
  });

  it("classifierModels의 @@typesafe 항목을 정규화함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      classifierModels: ["@@typesafe/jev"],
      profiles: {},
    });
    expect(config.classifierModels).toEqual([{ typesafe: true, model: "jev" }]);
    expect(warnings).toEqual([]);
  });

  it("프로필 classifierModels의 @@typesafe 항목도 처리함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      profiles: {
        p: { medium: { models: ["openai/a"] }, classifierModels: ["@@typesafe/jev-latest"] },
      },
    });
    expect(config.profiles.p.classifierModels).toEqual([{ typesafe: true, model: "jev-latest" }]);
    expect(warnings).toEqual([]);
  });

  it("classifierModels 단일 문자열은 거부함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      classifierModels: "openai/gpt-4o",
      profiles: {},
    });
    expect(config.classifierModels).toBeUndefined();
    expect(warnings.some((w) => w.includes("Expected an array"))).toBe(true);
  });

  it("typesafeConfidenceThreshold 값을 처리함을 검증함", () => {
    expect(
      normalizeConfig({ typesafeConfidenceThreshold: 0.7, profiles: {} }).config
        .typesafeConfidenceThreshold,
    ).toBe(0.7);
    expect(
      normalizeConfig({ typesafeConfidenceThreshold: 0, profiles: {} }).config
        .typesafeConfidenceThreshold,
    ).toBe(0);
    expect(normalizeConfig({ profiles: {} }).config.typesafeConfidenceThreshold).toBeUndefined();
  });

  it("잘못된 typesafeConfidenceThreshold는 warning 후 무시함을 검증함", () => {
    for (const invalid of [1.5, -0.1, "0.5", Number.NaN]) {
      const { config, warnings } = normalizeConfig({
        typesafeConfidenceThreshold: invalid,
        profiles: {},
      });
      expect(config.typesafeConfidenceThreshold).toBeUndefined();
      expect(warnings.some((w) => w.includes("Invalid typesafeConfidenceThreshold"))).toBe(true);
    }
  });
  it("object가 아닌 profile은 건너뜀을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { bad: "not-object" },
    });
    expect(warnings.some((w) => w.includes('Profile "bad" is not an object'))).toBe(true);
    expect(config.profiles.bad).toBeUndefined();
  });
  it("유효한 tier가 없는 profile은 건너뜀을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { empty: {} },
    });
    expect(warnings.some((w) => w.includes("has no valid tiers"))).toBe(true);
    expect(config.profiles.empty).toBeUndefined();
  });
  it("유효한 tier가 있는 profile은 유지함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    });
    expect(config.profiles.p.medium?.models).toEqual(["openai/gpt-4o"]);
    expect(warnings.length).toBe(0);
  });
  it("모든 tier 타입이 있는 profile을 처리함을 검증함", () => {
    const { config } = normalizeConfig({
      profiles: {
        p: {
          max: { models: ["openai/max"] },
          xhigh: { models: ["openai/xhigh"] },
          high: { models: ["openai/high"] },
          medium: { models: ["openai/medium"] },
          low: { models: ["openai/low"] },
          minimal: { models: ["openai/min"] },
        },
      },
    });
    expect(config.profiles.p.max?.models).toEqual(["openai/max"]);
    expect(config.profiles.p.xhigh?.models).toEqual(["openai/xhigh"]);
    expect(config.profiles.p.minimal?.models).toEqual(["openai/min"]);
  });
  it("profile classifierModels의 유효/무효 값을 처리함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      profiles: {
        p: {
          medium: { models: ["openai/gpt-4o"] },
          classifierModels: ["openai/c1#low", "bad"],
        },
      },
    });
    expect(config.profiles.p.classifierModels?.length).toBe(1);
    expect(warnings.some((w) => w.includes("classifierModels"))).toBe(true);
  });
  it("global classifierModels의 문자열과 배열을 처리함을 검증함", () => {
    const { config } = normalizeConfig({
      classifierModels: ["openai/gpt-4o#low", "google/gemini#high"],
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    });
    expect(config.classifierModels?.length).toBe(2);
  });
  it("잘못된 타입의 global classifierModels를 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      classifierModels: 123,
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    });
    expect(warnings.some((w) => w.includes("classifierModels"))).toBe(true);
    expect(config.classifierModels).toBeUndefined();
  });
  it("유효한 historySize 0, 20, 경계값을 처리함을 검증함", () => {
    expect(normalizeConfig({ historySize: 0, profiles: {} }).config.historySize).toBe(0);
    expect(normalizeConfig({ historySize: 20, profiles: {} }).config.historySize).toBe(20);
    expect(normalizeConfig({ historySize: 5, profiles: {} }).config.historySize).toBe(5);
  });
  it("무효한 historySize negative, >20, float, string, NaN을 처리함을 검증함", () => {
    const cases: unknown[] = [-1, 21, 3.5, "5", NaN, null];
    for (const v of cases) {
      const { warnings, config } = normalizeConfig({
        historySize: v,
        profiles: {},
      });
      expect(warnings.some((w) => w.includes("Invalid historySize"))).toBe(true);
      expect(config.historySize).toBe(0);
    }
  });
  it("historySize가 undefined면 기본값 0임을 검증함", () => {
    expect(normalizeConfig({ profiles: {} }).config.historySize).toBe(0);
  });
  it("알 수 없는 필드 없으면 warning 없음을 검증함", () => {
    const { warnings } = normalizeConfig({ debug: true, profiles: {} });
    expect(warnings.filter((w) => w.includes("Unknown"))).toEqual([]);
  });
  it("빈 object에 키가 없음을 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({});
    expect(warnings.length).toBe(0);
    expect(config.profiles).toEqual({});
  });
  it("다른 profile이 무효해도 유효한 profile을 보존함을 검증함", () => {
    const { config } = normalizeConfig({
      profiles: {
        good: { medium: { models: ["openai/gpt-4o"] } },
        bad: "not-object",
        empty: {},
      },
    });
    expect(config.profiles.good).toBeDefined();
    expect(config.profiles.bad).toBeUndefined();
    expect(config.profiles.empty).toBeUndefined();
  });
  it("무효한 모델이 있는 tier도 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { p: { high: { models: ["bad"] } } },
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.profiles.p).toBeUndefined();
  });
});
