import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../src/config/normalize";

describe("normalizeConfig 동작을 검증함", () => {
  it("알 수 없는 최상위 필드에 warning 남김을 검증함", () => {
    const { warnings } = normalizeConfig({
      unknownField: 123,
      routers: {},
    });
    expect(warnings.some((w) => w.includes('Unknown config field "unknownField"'))).toBe(true);
  });
  it("여러 알 수 없는 필드에 warning 남김을 검증함", () => {
    const { warnings } = normalizeConfig({ a: 1, b: 2, routers: {} });
    expect(warnings.filter((w) => w.includes("Unknown config field")).length).toBe(2);
  });
  it("debug true/false/non-boolean 값을 처리함을 검증함", () => {
    expect(normalizeConfig({ debug: true, routers: {} }).config.debug).toBe(true);
    expect(normalizeConfig({ debug: false, routers: {} }).config.debug).toBe(false);
    expect(normalizeConfig({ debug: "yes", routers: {} }).config.debug).toBe(false);
  });

  it("object가 아닌 router은 건너뜀을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      routers: { bad: "not-object" },
    });
    expect(warnings.some((w) => w.includes('Router "bad" is not an object'))).toBe(true);
    expect(config.routers.bad).toBeUndefined();
  });
  it("유효한 tier가 없는 router은 건너뜀을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      routers: { empty: {} },
    });
    expect(warnings.some((w) => w.includes("has no valid tiers"))).toBe(true);
    expect(config.routers.empty).toBeUndefined();
  });
  it("유효한 tier가 있는 router은 유지함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      routers: { p: { medium: { models: ["openai/gpt-4o"] } } },
    });
    expect(config.routers.p.medium?.models).toEqual(["openai/gpt-4o"]);
    expect(warnings.length).toBe(0);
  });
  it("모든 tier 타입이 있는 router을 처리함을 검증함", () => {
    const { config } = normalizeConfig({
      routers: {
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
    expect(config.routers.p.max?.models).toEqual(["openai/max"]);
    expect(config.routers.p.xhigh?.models).toEqual(["openai/xhigh"]);
    expect(config.routers.p.minimal?.models).toEqual(["openai/min"]);
  });
  it("알 수 없는 필드 없으면 warning 없음을 검증함", () => {
    const { warnings } = normalizeConfig({ debug: true, routers: {} });
    expect(warnings.filter((w) => w.includes("Unknown"))).toEqual([]);
  });
  it("빈 object에 키가 없음을 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({});
    expect(warnings.length).toBe(0);
    expect(config.routers).toEqual({});
  });
  it("다른 router이 무효해도 유효한 router을 보존함을 검증함", () => {
    const { config } = normalizeConfig({
      routers: {
        good: { medium: { models: ["openai/gpt-4o"] } },
        bad: "not-object",
        empty: {},
      },
    });
    expect(config.routers.good).toBeDefined();
    expect(config.routers.bad).toBeUndefined();
    expect(config.routers.empty).toBeUndefined();
  });
  it("무효한 모델이 있는 tier도 처리함을 검증함", () => {
    const { warnings, config } = normalizeConfig({
      routers: { p: { high: { models: ["bad"] } } },
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.routers.p).toBeUndefined();
  });
});
