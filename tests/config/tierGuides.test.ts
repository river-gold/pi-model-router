import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_GUIDES,
  TIER_GUIDE_ORDER,
  buildClassifierSystemPrompt,
  mergeTierGuides,
  normalizeTierGuides,
} from "../../src/config/tierGuides";
import { mergeConfig } from "../../src/config/merge";
import { normalizeConfig } from "../../src/config/normalize";
import type { RouterConfig } from "../../src/types";

describe("normalizeTierGuides", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeTierGuides(undefined)).toBeUndefined();
  });

  it("throws on non-object input", () => {
    for (const raw of ["low", 42, ["low"], null]) {
      expect(() => normalizeTierGuides(raw)).toThrow(
        "Invalid tierGuides: expected an object map of tier to description.",
      );
    }
  });

  it("throws on unknown tier keys", () => {
    expect(() => normalizeTierGuides({ ultra: "x", low: "custom low" })).toThrow(
      'Invalid tierGuides: unknown tier "ultra". Expected one of minimal, low, medium, high, xhigh, max.',
    );
  });

  it("throws on non-string values", () => {
    expect(() => normalizeTierGuides({ low: 123 })).toThrow(
      'Invalid tierGuides["low"]: expected non-blank string.',
    );
  });

  it("throws on empty string values", () => {
    expect(() => normalizeTierGuides({ low: "" })).toThrow(
      'Invalid tierGuides["low"]: expected non-blank string.',
    );
  });

  it("throws on whitespace-only values", () => {
    expect(() => normalizeTierGuides({ high: "   " })).toThrow(
      'Invalid tierGuides["high"]: expected non-blank string.',
    );
  });

  it("uses a custom context label in error messages", () => {
    expect(() => normalizeTierGuides("low", "custom")).toThrow(
      "Invalid custom: expected an object map of tier to description.",
    );
    expect(() => normalizeTierGuides({ ultra: "x" }, "custom")).toThrow(
      'Invalid custom: unknown tier "ultra". Expected one of minimal, low, medium, high, xhigh, max.',
    );
    expect(() => normalizeTierGuides({ low: "" }, "custom")).toThrow(
      'Invalid custom["low"]: expected non-blank string.',
    );
  });

  it("keeps valid partial overrides trimmed", () => {
    expect(normalizeTierGuides({ low: "  custom low  ", max: "custom max" })).toEqual({
      low: "custom low",
      max: "custom max",
    });
  });

  it("passes through all tiers", () => {
    expect(
      normalizeTierGuides({
        minimal: "custom minimal",
        low: "custom low",
        medium: "custom medium",
        high: "custom high",
        xhigh: "custom xhigh",
        max: "custom max",
      }),
    ).toEqual({
      minimal: "custom minimal",
      low: "custom low",
      medium: "custom medium",
      high: "custom high",
      xhigh: "custom xhigh",
      max: "custom max",
    });
  });

  it("returns an empty object for an empty object", () => {
    expect(normalizeTierGuides({})).toEqual({});
  });
});

describe("mergeTierGuides", () => {
  it("returns undefined when both missing", () => {
    expect(mergeTierGuides(undefined, undefined)).toBeUndefined();
  });

  it("returns base copy when override missing", () => {
    const base = { low: "a" };
    const merged = mergeTierGuides(base, undefined);
    expect(merged).toEqual({ low: "a" });
    expect(merged).not.toBe(base);
  });

  it("returns override copy when base missing", () => {
    const override = { high: "b" };
    const merged = mergeTierGuides(undefined, override);
    expect(merged).toEqual({ high: "b" });
    expect(merged).not.toBe(override);
  });

  it("overwrites overlapping tiers per-tier", () => {
    expect(mergeTierGuides({ low: "a", high: "base" }, { high: "over", max: "new" })).toEqual({
      low: "a",
      high: "over",
      max: "new",
    });
  });

  it("keeps base value when override entry is undefined", () => {
    expect(mergeTierGuides({ low: "a" }, { low: undefined })).toEqual({ low: "a" });
  });
});

describe("buildClassifierSystemPrompt", () => {
  it("uses defaults when guides undefined", () => {
    const prompt = buildClassifierSystemPrompt(undefined);
    for (const tier of TIER_GUIDE_ORDER) {
      expect(prompt).toContain(`- ${tier}: ${DEFAULT_TIER_GUIDES[tier]}`);
    }
  });

  it("applies partial override and keeps remaining defaults", () => {
    const prompt = buildClassifierSystemPrompt({ low: "custom low" });
    expect(prompt).toContain("- low: custom low");
    expect(prompt).toContain(`- high: ${DEFAULT_TIER_GUIDES.high}`);
    expect(prompt).toContain("Return ONLY one word");
  });

  it("renders tiers in display order", () => {
    const prompt = buildClassifierSystemPrompt({ max: "m", low: "l" });
    const positions = TIER_GUIDE_ORDER.map((tier) => prompt.indexOf(`- ${tier}:`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("tierGuides via normalizeConfig/mergeConfig", () => {
  it("passes through valid tierGuides", () => {
    const { config, warnings } = normalizeConfig({
      tierGuides: { low: "  custom low  " },
      profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
    } as unknown as RouterConfig);
    expect(config.tierGuides).toEqual({ low: "custom low" });
    expect(warnings).toEqual([]);
  });

  it("throws on invalid tierGuides", () => {
    for (const tierGuides of ["low", { bogus: "x" }, { high: "  " }, { low: 123 }]) {
      expect(() =>
        normalizeConfig({
          tierGuides,
          profiles: { p: { medium: { models: ["openai/gpt-4o"] } } },
        } as unknown as RouterConfig),
      ).toThrow("Invalid tierGuides");
    }
  });

  it("merges tierGuides per-tier", () => {
    const base: RouterConfig = {
      profiles: {},
      tierGuides: { low: "a", high: "base" },
    };
    const merged = mergeConfig(base, { tierGuides: { high: "over" } });
    expect(merged.tierGuides).toEqual({ low: "a", high: "over" });
    expect(mergeConfig({ profiles: {} }, {}).tierGuides).toBeUndefined();
  });
});
