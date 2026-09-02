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
} from "./config";
import type { RouterConfig, RouterProfile } from "./types";

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

describe("config.ts", () => {
  describe("type guards", () => {
    it("isObjectRecord should validate objects", () => {
      expect(isObjectRecord({})).toBe(true);
      expect(isObjectRecord(null)).toBe(false);
      expect(isRouterTier("high")).toBe(true);
      expect(isRouterTier("auto")).toBe(false);
    });
  });
  describe("parseConfigFile", () => {
    it("should return empty config for non-existent file", () => {
      expect(parseConfigFile("/path/does-not-exist").warnings).toEqual([]);
    });
    it("should warn on invalid json", () => {
      expect(parseConfigFile("/path/exists-invalid-json").warnings[0]).toContain("Failed to parse");
    });
  });
  describe("mergeConfig", () => {
    it("should merge profiles override", () => {
      const base: RouterConfig = {
        debug: false,
        profiles: {
          balanced: {
            medium: {
              models: ["openai/gpt-4o-mini"],
              model: "openai/gpt-4o-mini",
            },
          },
        },
      };
      const override: Partial<RouterConfig> = {
        debug: true,
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"], model: "openai/gpt-4o" },
          },
          cheap: {
            low: {
              models: ["openai/gpt-4o-mini"],
              model: "openai/gpt-4o-mini",
            },
          },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.profiles.balanced.medium?.models).toEqual(["openai/gpt-4o-mini"]);
      expect(merged.profiles.balanced.high?.models).toEqual(["openai/gpt-4o"]);
    });
  });
  describe("parseCanonicalModelRef", () => {
    it("should parse correct references", () => {
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
    it("should throw on missing slash", () => {
      expect(() => parseCanonicalModelRef("gpt-4o")).toThrow();
    });
  });
  describe("normalizeTierConfig", () => {
    it("should return undefined if not object", () => {
      expect(normalizeTierConfig("string", "p", "high", [])).toBeUndefined();
    });
    it("should warn if missing models", () => {
      const w: string[] = [];
      expect(normalizeTierConfig({}, "p", "high", w)).toBeUndefined();
      expect(w[0]).toContain('missing "models"');
    });
    it("should leave thinking undefined when omitted", () => {
      const w: string[] = [];
      expect(
        normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w)?.thinking,
      ).toBeUndefined();
    });
    it("should resolve and normalize details", () => {
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
  describe("normalizeConfig", () => {
    it("should normalize", () => {
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
  describe("historySize", () => {
    it("should handle historySize", () => {
      const { config } = normalizeConfig({
        historySize: 4,
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"], model: "openai/gpt-4o" },
          },
        },
      } as unknown as RouterConfig);
      expect(config.historySize).toBe(4);
    });
  });
  describe("classifierModels", () => {
    it("should leave thinking undefined when omitted", () => {
      const { config } = normalizeConfig({
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"], model: "openai/gpt-4o" },
          },
        },
        classifierModels: [{ model: "openai/gpt-4o" }],
      } as unknown as RouterConfig);
      expect(config.classifierModels?.[0].thinking).toBeUndefined();
    });
    it("should use string array form", () => {
      const { config } = normalizeConfig({
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"], model: "openai/gpt-4o" },
          },
        },
        classifierModels: ["openai/gpt-4o#low", "google/gemini-flash#off"] as unknown as any,
      } as unknown as RouterConfig);
      expect(config.classifierModels?.length).toBe(2);
      expect(config.classifierModels?.[0].thinking).toBe("low");
    });
    it("should support classifierModels fallback priority", () => {
      const { config } = normalizeConfig({
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"], model: "openai/gpt-4o" },
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
  describe("resolveDelegatedReasoning", () => {
    it("resolves", () => {
      expect(
        resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "off"),
      ).toBeUndefined();
      expect(resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "high")).toBe(
        "high",
      );
    });
  });
  describe("resolveEffectiveClassifier", () => {
    it("chains profile classifier then low tier", () => {
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
    it("falls back to low tier model as classifier (follows low tier thinking)", () => {
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
    it("returns undefined when no classifier and no low tier", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"] },
      };
      expect(resolveEffectiveClassifier(profile, undefined).classifiers).toBeUndefined();
      expect(resolveEffectiveClassifier(profile, undefined).source).toBe("none");
    });
  });
});
