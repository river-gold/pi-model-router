import { describe, expect, it, vi } from "vitest";
import { buildModelDefinitions, buildModelsKey } from "../../src/provider/models";
import type { RouterConfig } from "../../src/types";

describe("provider/models", () => {
  describe("buildModelDefinitions", () => {
    it("builds single profile with defaults", () => {
      const cfg: RouterConfig = {
        profiles: {
          balanced: {
            medium: {
              models: ["openai/gpt-4o"],
              resolvedContextWindow: 128000,
              resolvedMaxTokens: 16384,
            } as any,
          },
        },
      };
      const defs = buildModelDefinitions(cfg, undefined);
      expect(defs).toHaveLength(1);
      expect(defs[0].id).toBe("balanced");
      expect(defs[0].contextWindow).toBe(128000);
      expect(defs[0].maxTokens).toBe(16384);
    });

    it("computes max across tiers", () => {
      const cfg: RouterConfig = {
        profiles: {
          p: {
            low: {
              models: ["openai/low"],
              resolvedContextWindow: 10000,
              resolvedMaxTokens: 1000,
            } as any,
            high: {
              models: ["openai/high"],
              contextWindow: 200000,
              resolvedContextWindow: 200000,
              maxTokens: 50000,
              resolvedMaxTokens: 50000,
            } as any,
            medium: {
              models: ["openai/med"],
              resolvedContextWindow: 50000,
              resolvedMaxTokens: 2000,
            } as any,
          },
        },
      };
      // mock resolve to return the profile's values
      const defs = buildModelDefinitions(cfg, undefined);
      // The max should be 200000 and 50000 from high tier
      expect(defs[0].contextWindow).toBe(200000);
      expect(defs[0].maxTokens).toBe(50000);
    });

    it("uses registry when provided", () => {
      const registry = {
        find: vi.fn().mockReturnValue({ contextWindow: 200000, maxTokens: 50000 }),
      } as any;
      const cfg2: RouterConfig = {
        profiles: {
          p: {
            medium: { models: ["openai/gpt-4o"] } as any,
          },
        },
      };
      const defs = buildModelDefinitions(cfg2, registry);
      expect(defs[0].contextWindow).toBe(200000);
      expect(defs[0].maxTokens).toBe(50000);
    });

    it("handles multiple profiles sorted", () => {
      const cfg: RouterConfig = {
        profiles: {
          zebra: { medium: { models: ["openai/a"] } as any },
          alpha: { medium: { models: ["openai/b"] } as any },
        },
      };
      const defs = buildModelDefinitions(cfg, undefined);
      expect(defs.map((d) => d.id)).toEqual(["alpha", "zebra"]);
    });

    it("handles profile with no tiers? filtered", () => {
      const cfg: RouterConfig = {
        profiles: {
          empty: {} as any,
          balanced: { medium: { models: ["openai/a"] } as any },
        },
      };
      const defs = buildModelDefinitions(cfg, undefined);
      // empty profile has no tiers, so max stays default, but it's still included
      expect(defs.find((d) => d.id === "empty")).toBeDefined();
      expect(defs.find((d) => d.id === "balanced")).toBeDefined();
    });

    it("handles empty config", () => {
      const cfg: RouterConfig = { profiles: {} };
      expect(buildModelDefinitions(cfg, undefined)).toEqual([]);
    });
  });

  describe("buildModelsKey", () => {
    it("builds key", () => {
      const defs = [
        { id: "a", contextWindow: 100, maxTokens: 10, reasoning: true },
        { id: "b", contextWindow: 200, maxTokens: 20, reasoning: false },
      ] as any;
      expect(buildModelsKey(defs)).toBe("a:100:10:true,b:200:20:false");
    });

    it("empty", () => expect(buildModelsKey([] as any)).toBe(""));
    it("single", () =>
      expect(
        buildModelsKey([{ id: "x", contextWindow: 1, maxTokens: 2, reasoning: true } as any]),
      ).toBe("x:1:2:true"));
  });
});
