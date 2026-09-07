/* oxlint-disable */
import type { Api, Model } from "@earendil-works/pi-ai";
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
  resolveEffectiveClassifier,
} from "../src/config";
import type { RouterConfig, RouterProfile } from "../src/types";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/mock/agent/dir",
}));

vi.mock("node:fs", () => ({
  existsSync: (path: string) => path.includes("exists") || path.includes("model-router.json"),
  readFileSync: (path: string) => {
    if (path.includes("invalid-json")) return "{invalid";
    if (path.includes("not-object")) return "123";
    if (path.includes("global") || (path.endsWith("model-router.json") && !path.includes(".pi"))) {
      return JSON.stringify({
        debug: true,
        profiles: { globalProfile: { medium: { models: ["openai/gpt-4o"] } } },
      });
    }
    if (path.includes("project") || path.includes(".pi/model-router.json")) {
      return JSON.stringify({
        profiles: {
          projectProfile: { high: { models: ["google/gemini-1.5-pro"] } },
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
    it("profiles override를 병합한다", () => {
      const base: RouterConfig = {
        debug: false,
        profiles: {
          balanced: {
            medium: {
              models: ["openai/gpt-4o-mini"],
            },
          },
        },
      };
      const override: Partial<RouterConfig> = {
        debug: true,
        profiles: {
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
      expect(merged.profiles.balanced.medium?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.profiles.balanced.high?.models).toEqual(["openai/gpt-4o"]);
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
        thinking: "high",
      });
      expect(parseCanonicalModelRef("openai/gpt-4o#max")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        thinking: "max",
      });
      expect(parseCanonicalModelRef("openai/gpt-4o").thinking).toBeUndefined();
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
        normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w)?.thinking,
      ).toBeUndefined();
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
      expect(r?.thinking).toBe("high");
      expect(w.some((x) => x.includes("Invalid model"))).toBe(true);
    });
  });
  describe("normalizeConfig 정규화는", () => {
    it("config를 정규화한다", () => {
      const { config, warnings } = normalizeConfig({
        debug: true,
        classifierModels: ["openai/gpt-4o#medium"],
        profiles: { balanced: { high: { models: ["google/gemini-2.5-pro"] } } },
      } as unknown as RouterConfig);
      expect(
        warnings.filter((w) => !w.includes("deprecated") && !w.includes('"model" is removed')),
      ).toEqual([]);
      expect(config.classifierModels?.[0].model).toBe("openai/gpt-4o");
    });
  });
  describe("historySize 히스토리 크기는", () => {
    it("historySize를 처리한다", () => {
      const { config } = normalizeConfig({
        historySize: 4,
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"] },
          },
        },
      } as unknown as RouterConfig);
      expect(config.historySize).toBe(4);
    });
  });
  describe("classifierModels 분류 모델은", () => {
    it("생략되면 thinking을 undefined로 둔다", () => {
      const { config } = normalizeConfig({
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"] },
          },
        },
        classifierModels: ["openai/gpt-4o"],
      } as unknown as RouterConfig);
      expect(config.classifierModels?.[0].thinking).toBeUndefined();
    });
    it("문자열 배열 형태를 사용한다", () => {
      const { config } = normalizeConfig({
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"] },
          },
        },
        classifierModels: ["openai/gpt-4o#low", "google/gemini-flash#off"] as unknown as any,
      } as unknown as RouterConfig);
      expect(config.classifierModels?.length).toBe(2);
      expect(config.classifierModels?.[0].thinking).toBe("low");
    });
    it("classifierModels fallback 우선순위를 지원한다", () => {
      const { config } = normalizeConfig({
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"] },
          },
        },
        classifierModels: [
          "google/gemini-flash-latest#high",
          "google/gemini-flash-lite-latest#low",
        ] as unknown as any,
      } as unknown as RouterConfig);
      expect(config.classifierModels).toHaveLength(2);
      expect(config.classifierModels?.[1].thinking).toBe("low");
    });
  });
  describe("resolveDelegatedReasoning 위임 추론은", () => {
    it("값을 resolve한다", () => {
      expect(
        resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "off"),
      ).toBeUndefined();
      expect(resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "high")).toBe(
        "high",
      );
    });
  });
  describe("resolveEffectiveClassifier 유효 분류기는", () => {
    it("profile classifier 다음 low tier를 연결한다", () => {
      const profile: RouterProfile = {
        classifierModels: [{ model: "openai/gpt-4o", thinking: "low" }],
        low: { models: ["google/gemini-flash#low"] },
      };
      const result = resolveEffectiveClassifier(profile, undefined);
      expect(result.classifiers).toEqual([
        { model: "openai/gpt-4o", thinking: "low", source: "profile" },
        { model: "google/gemini-flash", thinking: "low", source: "low tier" },
      ]);
      expect(result.source).toBe("profile → low tier");
    });
    it("low tier 모델로 fallback한다 (low tier thinking을 따른다)", () => {
      const profile: RouterProfile = {
        low: { models: ["google/gemini-flash#high", "openai/gpt-4o-mini#off"] },
      };
      const result = resolveEffectiveClassifier(profile, undefined);
      expect(result.classifiers).toEqual([
        { model: "google/gemini-flash", thinking: "high", source: "low tier" },
        { model: "openai/gpt-4o-mini", thinking: "off", source: "low tier" },
      ]);
      expect(result.source).toBe("low tier");
    });
    it("classifier와 low tier가 없으면 undefined를 반환한다", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"] },
      };
      expect(resolveEffectiveClassifier(profile, undefined).classifiers).toBeUndefined();
      expect(resolveEffectiveClassifier(profile, undefined).source).toBe("none");
    });
  });
});
