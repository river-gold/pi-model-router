import { describe, expect, it, vi } from "vitest";
import { buildModelDefinitions, buildModelsKey } from "../../src/provider/models";
import type { RouterConfig } from "../../src/types";
import { makeFakeModel, makeFakeRegistry } from "../helpers";

describe("provider/models 모델 정의", () => {
  describe("buildModelDefinitions 모델 정의 생성", () => {
    it("기본값으로 단일 router 생성", () => {
      const cfg: RouterConfig = {
        routers: {
          balanced: {
            medium: {
              models: ["openai/gpt-4o"],
              resolvedContextWindow: 128000,
              resolvedMaxTokens: 16384,
            },
          },
        },
      };
      const defs = buildModelDefinitions(cfg, undefined);
      expect(defs).toHaveLength(1);
      expect(defs[0].id).toBe("balanced");
      expect(defs[0].contextWindow).toBe(128000);
      expect(defs[0].maxTokens).toBe(16384);
    });

    it("tier 전체에서 최대값 계산", () => {
      const cfg: RouterConfig = {
        routers: {
          p: {
            low: {
              models: ["openai/low"],
              resolvedContextWindow: 10000,
              resolvedMaxTokens: 1000,
            },
            high: {
              models: ["openai/high"],
              contextWindow: 200000,
              resolvedContextWindow: 200000,
              maxTokens: 50000,
              resolvedMaxTokens: 50000,
            },
            medium: {
              models: ["openai/med"],
              resolvedContextWindow: 50000,
              resolvedMaxTokens: 2000,
            },
          },
        },
      };
      // mock resolve to return the router's values
      const defs = buildModelDefinitions(cfg, undefined);
      // The max should be 200000 and 50000 from high tier
      expect(defs[0].contextWindow).toBe(200000);
      expect(defs[0].maxTokens).toBe(50000);
    });

    it("registry가 주어지면 사용", () => {
      const registry = makeFakeRegistry({
        find: vi.fn(() => makeFakeModel({ contextWindow: 200000, maxTokens: 50000 })),
      });
      const cfg2: RouterConfig = {
        routers: {
          p: {
            medium: { models: ["openai/gpt-4o"] },
          },
        },
      };
      const defs = buildModelDefinitions(cfg2, registry);
      expect(defs[0].contextWindow).toBe(200000);
      expect(defs[0].maxTokens).toBe(50000);
    });

    it("여러 router 정렬 처리", () => {
      const cfg: RouterConfig = {
        routers: {
          zebra: { medium: { models: ["openai/a"] } },
          alpha: { medium: { models: ["openai/b"] } },
        },
      };
      const defs = buildModelDefinitions(cfg, undefined);
      expect(defs.map((d) => d.id)).toEqual(["alpha", "zebra"]);
    });

    it("tier 없는 router 처리", () => {
      const cfg: RouterConfig = {
        routers: {
          empty: {},
          balanced: { medium: { models: ["openai/a"] } },
        },
      };
      const defs = buildModelDefinitions(cfg, undefined);
      // empty router has no tiers, so max stays default, but it's still included
      expect(defs.find((d) => d.id === "empty")).toBeDefined();
      expect(defs.find((d) => d.id === "balanced")).toBeDefined();
    });

    it("빈 config 처리", () => {
      const cfg: RouterConfig = { routers: {} };
      expect(buildModelDefinitions(cfg, undefined)).toEqual([]);
    });
  });

  describe("buildModelsKey 모델 키 생성", () => {
    it("키 생성", () => {
      const defs: ReturnType<typeof buildModelDefinitions> = [
        {
          id: "a",
          name: "a",
          reasoning: true,
          thinkingLevelMap: {},
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 100,
          maxTokens: 10,
        },
        {
          id: "b",
          name: "b",
          reasoning: false,
          thinkingLevelMap: {},
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200,
          maxTokens: 20,
        },
      ];
      expect(buildModelsKey(defs)).toBe("a:100:10:true,b:200:20:false");
    });

    it("빈 배열 처리", () => expect(buildModelsKey([])).toBe(""));
    it("단일 항목 처리", () =>
      expect(
        buildModelsKey([
          {
            id: "x",
            name: "x",
            reasoning: true,
            thinkingLevelMap: {},
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1,
            maxTokens: 2,
          },
        ]),
      ).toBe("x:1:2:true"));
  });
});
