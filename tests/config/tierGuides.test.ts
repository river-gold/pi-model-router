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

describe("normalizeTierGuides 동작을 검증함", () => {
  it("undefined 입력에 undefined 반환함을 검증함", () => {
    expect(normalizeTierGuides(undefined)).toBeUndefined();
  });

  it("non-object 입력에 throw함을 검증함", () => {
    for (const raw of ["low", 42, ["low"], null]) {
      expect(() => normalizeTierGuides(raw)).toThrow(
        "Invalid tierGuides: expected an object map of tier to description.",
      );
    }
  });

  it("알 수 없는 tier 키에 throw함을 검증함", () => {
    expect(() => normalizeTierGuides({ ultra: "x", low: "custom low" })).toThrow(
      'Invalid tierGuides: unknown tier "ultra". Expected one of minimal, low, medium, high, xhigh, max.',
    );
  });

  it("non-string 값에 throw함을 검증함", () => {
    expect(() => normalizeTierGuides({ low: 123 })).toThrow(
      'Invalid tierGuides["low"]: expected non-blank string.',
    );
  });

  it("빈 문자열 값에 throw함을 검증함", () => {
    expect(() => normalizeTierGuides({ low: "" })).toThrow(
      'Invalid tierGuides["low"]: expected non-blank string.',
    );
  });

  it("공백만 있는 값에 throw함을 검증함", () => {
    expect(() => normalizeTierGuides({ high: "   " })).toThrow(
      'Invalid tierGuides["high"]: expected non-blank string.',
    );
  });

  it("에러 메시지에 custom context label을 사용함을 검증함", () => {
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

  it("유효한 부분 override를 trim하여 유지함을 검증함", () => {
    expect(normalizeTierGuides({ low: "  custom low  ", max: "custom max" })).toEqual({
      low: "custom low",
      max: "custom max",
    });
  });

  it("모든 tier를 그대로 전달함을 검증함", () => {
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

  it("빈 object에 빈 object를 반환함을 검증함", () => {
    expect(normalizeTierGuides({})).toEqual({});
  });
});

describe("mergeTierGuides 동작을 검증함", () => {
  it("둘 다 없으면 undefined 반환함을 검증함", () => {
    expect(mergeTierGuides(undefined, undefined)).toBeUndefined();
  });

  it("override가 없으면 base 복사본을 반환함을 검증함", () => {
    const base = { low: "a" };
    const merged = mergeTierGuides(base, undefined);
    expect(merged).toEqual({ low: "a" });
    expect(merged).not.toBe(base);
  });

  it("base가 없으면 override 복사본을 반환함을 검증함", () => {
    const override = { high: "b" };
    const merged = mergeTierGuides(undefined, override);
    expect(merged).toEqual({ high: "b" });
    expect(merged).not.toBe(override);
  });

  it("겹치는 tier를 tier별로 덮어씀을 검증함", () => {
    expect(mergeTierGuides({ low: "a", high: "base" }, { high: "over", max: "new" })).toEqual({
      low: "a",
      high: "over",
      max: "new",
    });
  });

  it("override 항목이 undefined면 base 값을 유지함을 검증함", () => {
    expect(mergeTierGuides({ low: "a" }, { low: undefined })).toEqual({ low: "a" });
  });
});

describe("buildClassifierSystemPrompt 동작을 검증함", () => {
  it("guides가 undefined면 기본값을 사용함을 검증함", () => {
    const prompt = buildClassifierSystemPrompt(undefined);
    for (const tier of TIER_GUIDE_ORDER) {
      expect(prompt).toContain(`- ${tier}: ${DEFAULT_TIER_GUIDES[tier]}`);
    }
  });

  it("부분 override를 적용하고 나머지 기본값을 유지함을 검증함", () => {
    const prompt = buildClassifierSystemPrompt({ low: "custom low" });
    expect(prompt).toContain("- low: custom low");
    expect(prompt).toContain(`- high: ${DEFAULT_TIER_GUIDES.high}`);
    expect(prompt).toContain("Return ONLY one word");
  });

  it("tier를 표시 순서대로 렌더링함을 검증함", () => {
    const prompt = buildClassifierSystemPrompt({ max: "m", low: "l" });
    const positions = TIER_GUIDE_ORDER.map((tier) => prompt.indexOf(`- ${tier}:`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("normalizeConfig/mergeConfig 경유의 tierGuides를 검증함", () => {
  it("유효한 tierGuides를 그대로 전달함을 검증함", () => {
    const { config, warnings } = normalizeConfig({
      tierGuides: { low: "  custom low  " },
      routers: { p: { medium: { models: ["openai/gpt-4o"] } } },
    });
    expect(config.tierGuides).toEqual({ low: "custom low" });
    expect(warnings).toEqual([]);
  });

  it("무효한 tierGuides에 throw함을 검증함", () => {
    for (const tierGuides of ["low", { bogus: "x" }, { high: "  " }, { low: 123 }]) {
      expect(() =>
        normalizeConfig({
          tierGuides,
          routers: { p: { medium: { models: ["openai/gpt-4o"] } } },
        }),
      ).toThrow("Invalid tierGuides");
    }
  });

  it("tierGuides를 tier별로 병합함을 검증함", () => {
    const base: RouterConfig = {
      routers: {},
      tierGuides: { low: "a", high: "base" },
    };
    const merged = mergeConfig(base, { tierGuides: { high: "over" } });
    expect(merged.tierGuides).toEqual({ low: "a", high: "over" });
    expect(mergeConfig({ routers: {} }, {}).tierGuides).toBeUndefined();
  });
});
