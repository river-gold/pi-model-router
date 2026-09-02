import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../src/config/normalize";
import type { RouterConfig } from "../../src/types";

describe("normalizeConfig", () => {
  it("warns on unknown top-level fields", () => {
    const { warnings } = normalizeConfig({ unknownField: 123, profiles: {} } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes('Unknown config field "unknownField"'))).toBe(true);
  });
  it("multiple unknown fields", () => {
    const { warnings } = normalizeConfig({ a: 1, b: 2, profiles: {} } as unknown as RouterConfig);
    expect(warnings.filter((w) => w.includes("Unknown config field")).length).toBe(2);
  });
  it("debug true/false/non-boolean", () => {
    expect(normalizeConfig({ debug: true, profiles: {} } as unknown as RouterConfig).config.debug).toBe(true);
    expect(normalizeConfig({ debug: false, profiles: {} } as unknown as RouterConfig).config.debug).toBe(false);
    expect(normalizeConfig({ debug: "yes" as unknown as boolean, profiles: {} } as RouterConfig).config.debug).toBe(false);
  });
  it("profile not object -> skipped", () => {
    const { warnings, config } = normalizeConfig({ profiles: { bad: "not-object" as any } } as RouterConfig);
    expect(warnings.some((w) => w.includes('Profile "bad" is not an object'))).toBe(true);
    expect(config.profiles.bad).toBeUndefined();
  });
  it("profile with no valid tiers -> skipped", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { empty: {} as any },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes('has no valid tiers'))).toBe(true);
    expect(config.profiles.empty).toBeUndefined();
  });
  it("profile with valid tiers kept", () => {
    const { config, warnings } = normalizeConfig({
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
    expect(config.profiles.p.medium?.models).toEqual(["openai/gpt-4o"]);
    expect(warnings.length).toBe(0);
  });
  it("profile with all tier types", () => {
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
  it("profile classifierModels valid and invalid", () => {
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
  it("global classifierModels string and array", () => {
    const { config } = normalizeConfig({
      classifierModels: ["openai/gpt-4o#low", "google/gemini#high"] as unknown as any,
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
    expect(config.classifierModels?.length).toBe(2);
  });
  it("global classifierModels invalid type", () => {
    const { warnings, config } = normalizeConfig({
      classifierModels: 123 as unknown as any,
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("classifierModels"))).toBe(true);
    expect(config.classifierModels).toBeUndefined();
  });
  it("historySize valid 0, 20, boundary", () => {
    expect(normalizeConfig({ historySize: 0, profiles: {} } as unknown as RouterConfig).config.historySize).toBe(0);
    expect(normalizeConfig({ historySize: 20, profiles: {} } as unknown as RouterConfig).config.historySize).toBe(20);
    expect(normalizeConfig({ historySize: 5, profiles: {} } as unknown as RouterConfig).config.historySize).toBe(5);
  });
  it("historySize invalid negative, >20, float, string, NaN", () => {
    const cases = [-1, 21, 3.5, "5" as unknown as number, NaN, null as unknown as number];
    for (const v of cases) {
      const { warnings, config } = normalizeConfig({ historySize: v, profiles: {} } as unknown as RouterConfig);
      expect(warnings.some((w) => w.includes("Invalid historySize"))).toBe(true);
      expect(config.historySize).toBe(0);
    }
  });
  it("historySize undefined -> default 0", () => {
    expect(normalizeConfig({ profiles: {} } as unknown as RouterConfig).config.historySize).toBe(0);
  });
  it("no unknown fields no warning", () => {
    const { warnings } = normalizeConfig({ debug: true, profiles: {} } as unknown as RouterConfig);
    expect(warnings.filter((w) => w.includes("Unknown"))).toEqual([]);
  });
  it("empty object no keys", () => {
    const { warnings, config } = normalizeConfig({} as unknown as RouterConfig);
    expect(warnings.length).toBe(0);
    expect(config.profiles).toEqual({});
  });
  it("preserves valid profiles when others invalid", () => {
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
  it("tier with invalid models still handled", () => {
    const { warnings, config } = normalizeConfig({
      profiles: { p: { high: { models: ["bad"] } as any } },
    } as unknown as RouterConfig);
    expect(warnings.length).toBeGreaterThan(0);
    expect(config.profiles.p).toBeUndefined();
  });
});
