import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../src/config/merge";
import type { RouterConfig } from "../../src/types";

describe("merge를 검증함", () => {
  describe("mergeConfig 동작을 검증함", () => {
    it("새 cheap router을 병합함을 검증함", () => {
      const base: RouterConfig = {
        debug: false,
        routers: { balanced: { medium: { models: ["openai/gpt-4o-mini"] } } },
      };
      const override: Partial<RouterConfig> = {
        debug: true,
        routers: { cheap: { low: { models: ["openai/gpt-4o-mini"] } } },
      };
      const merged = mergeConfig(base, override);
      expect(merged.routers.balanced.medium?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.routers.cheap.low?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.debug).toBe(true);
    });
    it("겹치는 router tier를 병합함을 검증함", () => {
      const base: RouterConfig = {
        routers: {
          balanced: { medium: { models: ["openai/a"] }, low: { models: ["openai/low"] } },
        },
      };
      const override: Partial<RouterConfig> = {
        routers: {
          balanced: { high: { models: ["openai/high"] }, medium: { models: ["openai/b"] } },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.routers.balanced.medium?.models).toEqual(["openai/b"]);
      expect(merged.routers.balanced.high?.models).toEqual(["openai/high"]);
      expect(merged.routers.balanced.low?.models).toEqual(["openai/low"]);
    });
    it("non-object router을 건너뜀을 검증함", () => {
      const base: RouterConfig = { routers: {} };
      const override = {
        routers: { bad: "not-object" },
      };
      const merged = mergeConfig(base, override);
      expect(merged.routers.bad).toBeUndefined();
    });
    it("override가 undefined면 debug는 base를 유지함을 검증함", () => {
      const base: RouterConfig = { routers: {}, debug: true };
      expect(mergeConfig(base, {}).debug).toBe(true);
    });
    it("max, xhigh, minimal도 병합함을 검증함", () => {
      const base: RouterConfig = {
        routers: { p: { max: { models: ["openai/max"] } } },
      };
      const override: Partial<RouterConfig> = {
        routers: {
          p: { xhigh: { models: ["openai/xhigh"] }, minimal: { models: ["openai/min"] } },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.routers.p.max?.models).toEqual(["openai/max"]);
      expect(merged.routers.p.xhigh?.models).toEqual(["openai/xhigh"]);
      expect(merged.routers.p.minimal?.models).toEqual(["openai/min"]);
    });
  });
});
