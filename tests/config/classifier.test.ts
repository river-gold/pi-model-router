import { describe, expect, it } from "vitest";
import {
  normalizeClassifierConfig,
  normalizeClassifierModels,
  resolveEffectiveClassifier,
} from "../../src/config/classifier";

describe("classifier", () => {
  describe("normalizeClassifierConfig", () => {
    it("valid string without thinking", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o", w, "classifierModels")).toEqual({
        model: "openai/gpt-4o",
        thinking: undefined,
      });
      expect(w).toEqual([]);
    });
    it("valid string with thinking", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o#high", w, "classifierModels")).toEqual({
        model: "openai/gpt-4o",
        thinking: "high",
      });
    });
    it("trims", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig(" openai/gpt-4o#low ", w, "ctx")).toEqual({
        model: "openai/gpt-4o",
        thinking: "low",
      });
    });
    it("invalid ref -> warning and undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("invalid", w, "classifierModels")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid classifierModels/);
    });
    it("invalid thinking -> warning", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("openai/gpt-4o#bad", w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/Invalid ctx/);
    });
    it("empty string -> undefined no warning", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("", w, "ctx")).toBeUndefined();
      expect(w).toEqual([]);
    });
    it("whitespace only -> undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig("   ", w, "ctx")).toBeUndefined();
      expect(w).toEqual([]);
    });
    it("non-string -> undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierConfig(123, w, "ctx")).toBeUndefined();
      expect(normalizeClassifierConfig(null, w, "ctx")).toBeUndefined();
      expect(normalizeClassifierConfig({}, w, "ctx")).toBeUndefined();
      expect(w).toEqual([]);
    });
  });

  describe("normalizeClassifierModels", () => {
    it("undefined -> undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(undefined, w, "classifierModels")).toBeUndefined();
      expect(w).toEqual([]);
    });
    it("string valid -> array", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels("openai/gpt-4o#low", w, "ctx")).toEqual([
        { model: "openai/gpt-4o", thinking: "low" },
      ]);
    });
    it("string invalid -> undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels("bad", w, "ctx")).toBeUndefined();
      expect(w.length).toBe(1);
    });
    it("array with mix valid/invalid", () => {
      const w: string[] = [];
      const r = normalizeClassifierModels(["openai/gpt-4o#high", "invalid", "google/gemini#low"], w, "ctx");
      expect(r).toEqual([
        { model: "openai/gpt-4o", thinking: "high" },
        { model: "google/gemini", thinking: "low" },
      ]);
      expect(w.length).toBe(1);
    });
    it("array empty -> undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels([], w, "ctx")).toBeUndefined();
    });
    it("array all invalid -> undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(["bad", "also/bad#invalid"], w, "ctx")).toBeUndefined();
    });
    it("invalid type number -> warning undefined", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels(123, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string or array/);
    });
    it("invalid type object -> warning", () => {
      const w: string[] = [];
      expect(normalizeClassifierModels({}, w, "ctx")).toBeUndefined();
      expect(w[0]).toMatch(/expected string or array/);
    });
  });

  describe("resolveEffectiveClassifier", () => {
    it("profile only", () => {
      const profile = { classifierModels: [{ model: "openai/gpt-4o", thinking: "low" as const }] };
      const r = resolveEffectiveClassifier(profile, undefined);
      expect(r.classifiers).toEqual([{ model: "openai/gpt-4o", thinking: "low", source: "profile" }]);
      expect(r.source).toBe("profile");
    });
    it("global only", () => {
      const profile = {};
      const r = resolveEffectiveClassifier(profile as any, [{ model: "openai/gpt-4o", thinking: "high" as const }]);
      expect(r.classifiers).toEqual([{ model: "openai/gpt-4o", thinking: "high", source: "global" }]);
      expect(r.source).toBe("global");
    });
    it("low only", () => {
      const profile = { low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(profile as any, undefined);
      expect(r.classifiers).toEqual([{ model: "google/gemini", thinking: "low", source: "low tier" }]);
      expect(r.source).toBe("low tier");
    });
    it("profile+global+low", () => {
      const profile = {
        classifierModels: [{ model: "openai/a", thinking: "low" as const }],
        low: { models: ["google/gemini#high"] },
      };
      const global = [{ model: "openai/b", thinking: "medium" as const }];
      const r = resolveEffectiveClassifier(profile as any, global);
      expect(r.classifiers).toEqual([
        { model: "openai/a", thinking: "low", source: "profile" },
        { model: "openai/b", thinking: "medium", source: "global" },
        { model: "google/gemini", thinking: "high", source: "low tier" },
      ]);
      expect(r.source).toBe("profile → global → low tier");
    });
    it("profile+low", () => {
      const profile = {
        classifierModels: [{ model: "openai/gpt-4o", thinking: "low" as const }],
        low: { models: ["google/gemini#low"] },
      };
      const r = resolveEffectiveClassifier(profile as any, undefined);
      expect(r.source).toBe("profile → low tier");
      expect(r.classifiers?.length).toBe(2);
    });
    it("none -> undefined source none", () => {
      const profile = { high: { models: ["openai/gpt-4o"] } };
      const r = resolveEffectiveClassifier(profile as any, undefined);
      expect(r.classifiers).toBeUndefined();
      expect(r.source).toBe("none");
    });
    it("low with multiple models and thinking", () => {
      const profile = { low: { models: ["google/gemini#high", "openai/gpt-4o-mini#off"] } };
      const r = resolveEffectiveClassifier(profile as any, undefined);
      expect(r.classifiers).toEqual([
        { model: "google/gemini", thinking: "high", source: "low tier" },
        { model: "openai/gpt-4o-mini", thinking: "off", source: "low tier" },
      ]);
    });
    it("low empty -> ignored", () => {
      const profile = { low: { models: [] } };
      const r = resolveEffectiveClassifier(profile as any, undefined);
      expect(r.classifiers).toBeUndefined();
    });
    it("profile classifier empty -> ignored", () => {
      const profile = { classifierModels: [] as any, low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(profile as any, undefined);
      expect(r.source).toBe("low tier");
    });
    it("global empty -> ignored", () => {
      const profile = { low: { models: ["google/gemini#low"] } };
      const r = resolveEffectiveClassifier(profile as any, []);
      expect(r.source).toBe("low tier");
    });
  });
});
