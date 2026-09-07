import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../src/config/normalize";
import type { RouterConfig } from "../../src/types";

describe("normalizeConfig 동작을 검증함", () => {
  it("알 수 없는 최상위 필드에 warning 남김을 검증함", () => {
    const { warnings } = normalizeConfig({
      unknownField: 123,
      profiles: {},
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes('Unknown config field "unknownField"'))).toBe(true);
  });
  it("여러 알 수 없는 필드에 warning 남김을 검증함", () => {
    const { warnings } = normalizeConfig({ a: 1, b: 2, profiles: {} } as unknown as RouterConfig);
    expect(warnings.filter((w) => w.includes("Unknown config field")).length).toBe(2);
  });
  it("debug true/false/non-boolean 값을 처리함을 검증함", () => {
    expect(
      normalizeConfig({ debug: true, profiles: {} } as unknown as RouterConfig).config.debug,
    ).toBe(true);
    expect(
      normalizeConfig({ debug: false, profiles: {} } as unknown as RouterConfig).config.debug,
    ).toBe(false);
    expect(
      normalizeConfig({ debug: "yes" as unknown as boolean, profiles: {} } as RouterConfig).config
        .debug,
    ).toBe(false);
  });
  it("object가 아닌 profile은 건너뜀을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { bad: "not-object" as any },
    } as RouterConfig);
    expect(warnings.some((w) => w.includes('Profile "bad" is not an object'))).toBe(true);
    expect(config.profiles.bad).toBeUndefined();
  });
  it("유효한 tier가 없는 profile은 건너뜀을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { empty: {} as any },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("has no valid tiers"))).toBe(true);
    expect(config.profiles.empty).toBeUndefined();
  });
  it("유효한 tier가 있는 profile은 유지함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
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
    } as unknown as RouterConfig);
    expect(config.profiles.p.max?.models).toEqual(["openai/max"]);
    expect(config.profiles.p.xhigh?.models).toEqual(["openai/xhigh"]);
    expect(config.profiles.p.minimal?.models).toEqual(["openai/min"]);
  });
  it("profile classifierModels의 유효/무효 값을 처리함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      profiles: {
        p: {
          medium: { models: ["openai/gpt-4o"] },
          classifierModels: ["openai/c1#low", "bad"] as unknown as any,
        },
      },
    } as unknown as RouterConfig);
    expect(config.profiles.p.classifierModels?.length).toBe(1);
    expect(warnings.some((w) => w.includes("classifierModels"))).toBe(true);
  });
  it("global classifierModels의 문자열과 배열을 처리함을 검증함", () => {
    const { config } = normalizeConfig({
      classifierModels: ["openai/gpt-4o#low", "google/gemini#high"] as unknown as any,
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
    expect(config.classifierModels?.length).toBe(2);
  });
  it("잘못된 타입의 global classifierModels를 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      classifierModels: 123 as unknown as any,
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("classifierModels"))).toBe(true);
    expect(config.classifierModels).toBeUndefined();
  });
  it("유효한 historySize 0, 20, 경계값을 처리함을 검증함", () => {
    expect(
      normalizeConfig({ historySize: 0, profiles: {} } as unknown as RouterConfig).config
        .historySize,
    ).toBe(0);
    expect(
      normalizeConfig({ historySize: 20, profiles: {} } as unknown as RouterConfig).config
        .historySize,
    ).toBe(20);
    expect(
      normalizeConfig({ historySize: 5, profiles: {} } as unknown as RouterConfig).config
        .historySize,
    ).toBe(5);
  });
  it("무효한 historySize negative, >20, float, string, NaN을 처리함을 검증함", () => {
    const cases = [-1, 21, 3.5, "5" as unknown as number, NaN, null as unknown as number];
    for (const v of cases) {
      const { warnings, config } = normalizeConfig({
        historySize: v,
        profiles: {},
      } as unknown as RouterConfig);
      expect(warnings.some((w) => w.includes("Invalid historySize"))).toBe(true);
      expect(config.historySize).toBe(0);
    }
  });
  it("historySize가 undefined면 기본값 0임을 검증함", () => {
    expect(normalizeConfig({ profiles: {} } as unknown as RouterConfig).config.historySize).toBe(0);
  });
  it("알 수 없는 필드 없으면 warning 없음을 검증함", () => {
    const { warnings } = normalizeConfig({ debug: true, profiles: {} } as unknown as RouterConfig);
    expect(warnings.filter((w) => w.includes("Unknown"))).toEqual([]);
  });
  it("빈 object에 키가 없음을 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({} as unknown as RouterConfig);
    expect(warnings.length).toBe(0);
    expect(config.profiles).toEqual({});
  });
  it("다른 profile이 무효해도 유효한 profile을 보존함을 검증함", () => {
    const { config } = normalizeConfig({
      profiles: {
        good: { medium: { models: ["openai/gpt-4o"] } },
        bad: "not-object" as any,
        empty: {} as any,
      },
    } as unknown as RouterConfig);
    expect(config.profiles.good).toBeDefined();
    expect(config.profiles.bad).toBeUndefined();
    expect(config.profiles.empty).toBeUndefined();
  });
  it("무효한 모델이 있는 tier도 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { p: { high: { models: ["bad"] } as any } },
    } as unknown as RouterConfig);
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.profiles.p).toBeUndefined();
  });
});
