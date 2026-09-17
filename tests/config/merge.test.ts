import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../src/config/merge";
import type { RouterConfig } from "../../src/types";

describe("merge를 검증함", () => {
  describe("mergeConfig 동작을 검증함", () => {
    it("새 cheap profile을 병합함을 검증함", () => {
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
    it("겹치는 profile tier를 병합함을 검증함", () => {
      const base: RouterConfig = {
        profiles: {
          balanced: { medium: { models: ["openai/a"] }, low: { models: ["openai/low"] } },
        },
      };
      const override: Partial<RouterConfig> = {
        profiles: {
          balanced: { high: { models: ["openai/high"] }, medium: { models: ["openai/b"] } },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.balanced.medium?.models).toEqual(["openai/b"]);
      expect(merged.profiles.balanced.high?.models).toEqual(["openai/high"]);
      expect(merged.profiles.balanced.low?.models).toEqual(["openai/low"]);
    });
    it("non-object profile을 건너뜀을 검증함", () => {
      const base: RouterConfig = { profiles: {} };
      const override = {
        profiles: { bad: "not-object" },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.bad).toBeUndefined();
    });
    it("classifierModels를 override로 교체함을 검증함", () => {
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
    it("override가 undefined면 classifierModels는 base를 유지함을 검증함", () => {
      const base: RouterConfig = {
        profiles: {},
        classifierModels: [{ model: "openai/a" }],
      };
      const merged = mergeConfig(base, {});
      expect(merged.classifierModels?.[0].model).toBe("openai/a");
    });
    it("historySize를 override에서 가져옴을 검증함", () => {
      const base: RouterConfig = { profiles: {}, historySize: 2 };
      const override = { historySize: 5 };
      expect(mergeConfig(base, override).historySize).toBe(5);
    });
    it("override가 undefined면 historySize는 base를 유지함을 검증함", () => {
      const base: RouterConfig = { profiles: {}, historySize: 3 };
      expect(mergeConfig(base, {}).historySize).toBe(3);
    });
    it("historySize override 0을 처리함을 검증함", () => {
      const base: RouterConfig = { profiles: {}, historySize: 5 };
      const override = { historySize: 0 };
      expect(mergeConfig(base, override).historySize).toBe(0);
    });
    it("override가 undefined면 debug는 base를 유지함을 검증함", () => {
      const base: RouterConfig = { profiles: {}, debug: true };
      expect(mergeConfig(base, {}).debug).toBe(true);
    });
    it("profile classifierModels를 병합함을 검증함", () => {
      const base: RouterConfig = {
        profiles: {
          p: { medium: { models: ["openai/a"] }, classifierModels: [{ model: "openai/c1" }] },
        },
      };
      const override: Partial<RouterConfig> = {
        profiles: { p: { classifierModels: [{ model: "openai/c2" }] } },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.p.classifierModels?.[0].model).toBe("openai/c2");
    });
    it("next가 undefined면 profile classifierModels는 기존 값을 유지함을 검증함", () => {
      const base: RouterConfig = {
        profiles: {
          p: { medium: { models: ["openai/a"] }, classifierModels: [{ model: "openai/c1" }] },
        },
      };
      const override: Partial<RouterConfig> = {
        profiles: { p: { high: { models: ["openai/high"] } } },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.p.classifierModels?.[0].model).toBe("openai/c1");
    });
    it("max, xhigh, minimal도 병합함을 검증함", () => {
      const base: RouterConfig = {
        profiles: { p: { max: { models: ["openai/max"] } } },
      };
      const override: Partial<RouterConfig> = {
        profiles: {
          p: { xhigh: { models: ["openai/xhigh"] }, minimal: { models: ["openai/min"] } },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.p.max?.models).toEqual(["openai/max"]);
      expect(merged.profiles.p.xhigh?.models).toEqual(["openai/xhigh"]);
      expect(merged.profiles.p.minimal?.models).toEqual(["openai/min"]);
    });
    it("typesafeConfidenceThreshold를 override에서 가져옴을 검증함", () => {
      const base: RouterConfig = {
        profiles: {},
        typesafeConfidenceThreshold: 0.3,
      };
      const merged = mergeConfig(base, { typesafeConfidenceThreshold: 0.9 });
      expect(merged.typesafeConfidenceThreshold).toBe(0.9);
    });
    it("override가 없으면 typesafeConfidenceThreshold는 base를 유지함을 검증함", () => {
      const base: RouterConfig = {
        profiles: {},
        typesafeConfidenceThreshold: 0.4,
      };
      const merged = mergeConfig(base, {});
      expect(merged.typesafeConfidenceThreshold).toBe(0.4);
    });
    it("classifierModels TypeSafe 참조를 override에서 가져옴을 검증함", () => {
      const base: RouterConfig = {
        profiles: {},
        classifierModels: [{ typesafe: true, model: "jev" }],
      };
      const merged = mergeConfig(base, {});
      expect(merged.classifierModels).toEqual([{ typesafe: true, model: "jev" }]);
    });
  });
});
