import { describe, expect, it, vi } from "vitest";
import {
  isObjectRecord,
  isRouterTier,
  mergeConfig,
  normalizeConfig,
  normalizeTierConfig,
  parseCanonicalModelRef,
  parseConfigFile,
  resolveDelegatedReasoning,
} from "../src/config";
import type { RouterConfig } from "../src/types";
import { makeFakeModel } from "./helpers";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/mock/agent/dir",
}));

vi.mock("node:fs", () => ({
  existsSync: (path: string) => path.includes("exists") || path.includes("pi-model-router.json"),
  readFileSync: (path: string) => {
    if (path.includes("invalid-json")) return "{invalid";
    if (path.includes("not-object")) return "123";
    if (
      path.includes("global") ||
      (path.endsWith("pi-model-router.json") && !path.includes(".pi"))
    ) {
      return JSON.stringify({
        debug: true,
        routers: { globalRouter: { medium: { models: ["openai/gpt-4o"] } } },
      });
    }
    if (path.includes("project") || path.includes(".pi/pi-model-router.json")) {
      return JSON.stringify({
        routers: {
          projectRouter: { high: { models: ["google/gemini-1.5-pro"] } },
        },
      });
    }
    return "{}";
  },
}));

describe("config.ts 설정은", () => {
  describe("type guards 타입 가드는", () => {
    it("isObjectRecord는 객체를 검증한다", () => {
      expect(isObjectRecord({})).toBe(true);
      expect(isObjectRecord(null)).toBe(false);
      expect(isRouterTier("high")).toBe(true);
      expect(isRouterTier("auto")).toBe(false);
    });
  });
  describe("parseConfigFile 파일 파싱은", () => {
    it("존재하지 않는 파일이면 빈 config를 반환한다", () => {
      expect(parseConfigFile("/path/does-not-exist").warnings).toEqual([]);
    });
    it("유효하지 않은 json이면 경고를 반환한다", () => {
      expect(parseConfigFile("/path/exists-invalid-json").warnings[0]).toContain("Failed to parse");
    });
  });
  describe("mergeConfig 병합은", () => {
    it("routers override를 병합한다", () => {
      const base: RouterConfig = {
        debug: false,
        routers: {
          balanced: {
            medium: {
              models: ["openai/gpt-4o-mini"],
            },
          },
        },
      };
      const override: Partial<RouterConfig> = {
        debug: true,
        routers: {
          balanced: {
            high: { models: ["openai/gpt-4o"] },
          },
          cheap: {
            low: {
              models: ["openai/gpt-4o-mini"],
            },
          },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.routers.balanced.medium?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.routers.balanced.high?.models).toEqual(["openai/gpt-4o"]);
    });
  });
  describe("parseCanonicalModelRef 참조 파싱은", () => {
    it("올바른 참조를 파싱한다", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
      expect(parseCanonicalModelRef("openai/gpt-4o#high")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        effort: "high",
      });
      expect(parseCanonicalModelRef("openai/gpt-4o#max")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        effort: "max",
      });
      expect(parseCanonicalModelRef("openai/gpt-4o").effort).toBeUndefined();
    });
    it("slash가 없으면 throw한다", () => {
      expect(() => parseCanonicalModelRef("gpt-4o")).toThrow();
    });
  });
  describe("normalizeTierConfig 티어 정규화는", () => {
    it("객체가 아니면 undefined를 반환한다", () => {
      expect(normalizeTierConfig("string", "p", "high", [])).toBeUndefined();
    });
    it("models가 없으면 경고를 반환한다", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({}, "p", "high", w)).toBeUndefined();
      expect(w[0]).toContain('missing "models"');
    });
    it("생략되면 thinking을 undefined로 둔다", () => {
      const w: string[] = [];
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w)?.effort,
      ).toBeUndefined();
    });
    it("effort가 있으면 # 없는 모델의 기본값으로 적용한다", () => {
      const w: string[] = [];
      const r = normalizeTierConfig(
        {
          models: ["openai/gpt-4o#max", "google/gemini-flash", "openai/gpt-4o-mini"],
          effort: "high",
        },
        "p",
        "medium",
        w,
      );
      expect(w).toEqual([]);
      expect(r?.effort).toBe("high");
      expect(r?.models).toEqual(["openai/gpt-4o#max", "google/gemini-flash", "openai/gpt-4o-mini"]);
    });
    it("제거된 thinking 필드는 무시한다", () => {
      const w: string[] = [];
      const r = normalizeTierConfig(
        { models: ["openai/gpt-4o"], thinking: "low", effort: "high" },
        "p",
        "medium",
        w,
      );
      expect(r?.effort).toBe("high");
      expect(w).toEqual([]);
    });
    it("유효하지 않은 effort는 경고 + 무시한다", () => {
      const w: string[] = [];
      const r = normalizeTierConfig(
        { models: ["openai/gpt-4o#low"], effort: "ultra" },
        "p",
        "medium",
        w,
      );
      expect(r?.effort).toBeUndefined();
      expect(w.some((x) => x.includes("invalid effort"))).toBe(true);

      const w2: string[] = [];
      const r2 = normalizeTierConfig(
        { models: ["openai/gpt-4o#low"], effort: 123 },
        "p",
        "medium",
        w2,
      );
      expect(r2?.effort).toBeUndefined();
      expect(w2.some((x) => x.includes("invalid effort"))).toBe(true);
    });
    it("세부 정보를 resolve하고 정규화한다", () => {
      const w: string[] = [];
      const raw = {
        models: ["openai/gpt-4o#high", "google/gemini-1.5-flash#low", "invalid-fallback"],
        contextWindow: 50000,
        maxTokens: 2000,
      };
      const r = normalizeTierConfig(raw, "p", "high", w);
      expect(r?.models).toEqual(["openai/gpt-4o#high", "google/gemini-1.5-flash#low"]);
      // 모델별 `#`는 tier 강제값으로 승격되지 않음.
      expect(r?.effort).toBeUndefined();
      expect(w.some((x) => x.includes("Invalid model"))).toBe(true);
    });
  });
  describe("normalizeConfig 정규화는", () => {
    it("config를 정규화한다", () => {
      const { config, warnings } = normalizeConfig({
        debug: true,
        routers: { balanced: { high: { models: ["google/gemini-2.5-pro"] } } },
      });
      expect(warnings).toEqual([]);
      expect(config.routers.balanced.high?.models).toEqual(["google/gemini-2.5-pro"]);
    });
    it("라우터 models를 effort만 있는 티어에 상속한다", () => {
      const { config, warnings } = normalizeConfig({
        routers: {
          deepseek: {
            models: ["openai/gpt-4o", "google/gemini-flash"],
            high: { effort: "max" },
            low: { models: ["openai/gpt-4o-mini"], effort: "low" },
          },
        },
      });
      expect(warnings).toEqual([]);
      expect(config.routers.deepseek.models).toEqual(["openai/gpt-4o", "google/gemini-flash"]);
      expect(config.routers.deepseek.high?.models).toEqual([
        "openai/gpt-4o",
        "google/gemini-flash",
      ]);
      expect(config.routers.deepseek.high?.effort).toBe("max");
      expect(config.routers.deepseek.low?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(config.routers.deepseek.low?.effort).toBe("low");
    });
    it("무효한 라우터 models는 경고 후 무시한다", () => {
      const { config, warnings } = normalizeConfig({
        routers: {
          p: {
            models: ["bad", "also/bad#invalid"],
            high: { models: ["openai/gpt-4o"] },
          },
        },
      });
      expect(config.routers.p.models).toBeUndefined();
      expect(config.routers.p.high?.models).toEqual(["openai/gpt-4o"]);
      expect(warnings.some((x) => x.includes('router-level "models"'))).toBe(true);
    });
  });
  describe("resolveDelegatedReasoning 위임 추론은", () => {
    it("값을 resolve한다", () => {
      expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), "off")).toBeUndefined();
      expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), "high")).toBe("high");
    });
    it("유효하지 않은 thinking은 undefined를 반환한다", () => {
      expect(
        resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), "turbo"),
      ).toBeUndefined();
    });
  });
});
