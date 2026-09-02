import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../src/config/merge";
import type { RouterConfig } from "../../src/types";

describe("merge", () => {
  describe("mergeConfig", () => {
    it("merges new profile cheap", () => {
      const base: RouterConfig = {
        debug: false,
        profiles: { balanced: { medium: { models: ["openai/gpt-4o-mini"] } } },
      };
      const override: Partial<RouterConfig> = {
        debug: true,
        profiles: { cheap: { low: { models: ["openai/gpt-4o-mini"] } } },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.balanced.medium?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.profiles.cheap.low?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.debug).toBe(true);
    });
    it("merges overlapping profile tiers", () => {
      const base: RouterConfig = {
        profiles: { balanced: { medium: { models: ["openai/a"] }, low: { models: ["openai/low"] } } },
      };
      const override: Partial<RouterConfig> = {
        profiles: { balanced: { high: { models: ["openai/high"] }, medium: { models: ["openai/b"] } } },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.balanced.medium?.models).toEqual(["openai/b"]);
      expect(merged.profiles.balanced.high?.models).toEqual(["openai/high"]);
      expect(merged.profiles.balanced.low?.models).toEqual(["openai/low"]);
    });
    it("skips non-object profile", () => {
      const base: RouterConfig = { profiles: {} };
      const override = { profiles: { bad: "not-object" as unknown as any } } as Partial<RouterConfig>;
      const merged = mergeConfig(base, override);
      expect(merged.profiles.bad).toBeUndefined();
    });
    it("classifierModels override", () => {
      const base: RouterConfig = {
        profiles: {},
        classifierModels: [{ model: "openai/a" }],
      };
      const override: Partial<RouterConfig> = {
        classifierModels: [{ model: "openai/b" }],
      };
      const merged = mergeConfig(base, override);
      expect(merged.classifierModels?.[0].model).toBe("openai/b");
    });
    it("classifierModels keeps base if override undefined", () => {
      const base: RouterConfig = {
        profiles: {},
        classifierModels: [{ model: "openai/a" }],
      };
      const merged = mergeConfig(base, {});
      expect(merged.classifierModels?.[0].model).toBe("openai/a");
    });
    it("historySize from override", () => {
      const base: RouterConfig = { profiles: {}, historySize: 2 };
      const override = { historySize: 5 } as unknown as Partial<RouterConfig>;
      expect(mergeConfig(base, override).historySize).toBe(5);
    });
    it("historySize keeps base if override undefined", () => {
      const base: RouterConfig = { profiles: {}, historySize: 3 };
      expect(mergeConfig(base, {}).historySize).toBe(3);
    });
    it("historySize override 0", () => {
      const base: RouterConfig = { profiles: {}, historySize: 5 };
      const override = { historySize: 0 } as unknown as Partial<RouterConfig>;
      expect(mergeConfig(base, override).historySize).toBe(0);
    });
    it("debug keeps base if override undefined", () => {
      const base: RouterConfig = { profiles: {}, debug: true };
      expect(mergeConfig(base, {}).debug).toBe(true);
    });
    it("profile classifierModels merging", () => {
      const base: RouterConfig = {
        profiles: { p: { medium: { models: ["openai/a"] }, classifierModels: [{ model: "openai/c1" }] } },
      };
      const override: Partial<RouterConfig> = {
        profiles: { p: { classifierModels: [{ model: "openai/c2" }] } as any },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.p.classifierModels?.[0].model).toBe("openai/c2");
    });
    it("profile classifierModels keeps existing if next undefined", () => {
      const base: RouterConfig = {
        profiles: { p: { medium: { models: ["openai/a"] }, classifierModels: [{ model: "openai/c1" }] } },
      };
      const override: Partial<RouterConfig> = {
        profiles: { p: { high: { models: ["openai/high"] } } as any },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.p.classifierModels?.[0].model).toBe("openai/c1");
    });
    it("merges max, xhigh, minimal too", () => {
      const base: RouterConfig = {
        profiles: { p: { max: { models: ["openai/max"] } } },
      };
      const override: Partial<RouterConfig> = {
        profiles: { p: { xhigh: { models: ["openai/xhigh"] }, minimal: { models: ["openai/min"] } } as any },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.p.max?.models).toEqual(["openai/max"]);
      expect(merged.profiles.p.xhigh?.models).toEqual(["openai/xhigh"]);
      expect(merged.profiles.p.minimal?.models).toEqual(["openai/min"]);
    });
  });
});
