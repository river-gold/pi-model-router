import { describe, expect, it } from "vitest";
import { formatModelRef, parseCanonicalModelRef } from "../../src/config/modelRef";

describe("modelRef를 검증함", () => {
  describe("parseCanonicalModelRef 동작을 검증함", () => {
    it("effort 없이 파싱함을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
      "effort %s와 함께 파싱함을 검증함",
      (effort) => {
        expect(parseCanonicalModelRef(`openai/gpt-4o#${effort}`)).toEqual({
          provider: "openai",
          modelId: "gpt-4o",
          effort,
        });
      },
    );
    it("provider와 modelId의 공백을 제거함을 검증함", () => {
      expect(parseCanonicalModelRef(" openai / gpt-4o #high ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        effort: "high",
      });
    });
    it("effort 원시값의 공백을 제거함을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o# high ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        effort: "high",
      });
    });
    it("# 뒤 effort가 비면 effort 없음을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o#")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it("# 뒤 공백만 있으면 effort 없음을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o#   ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it("slash 누락 시 throw함을 검증함", () => {
      expect(() => parseCanonicalModelRef("gpt-4o")).toThrow(/Expected "provider\/model/);
    });
    it("provider가 비면 throw함을 검증함", () => {
      expect(() => parseCanonicalModelRef("/gpt-4o")).toThrow();
    });
    it("modelId가 비면 throw함을 검증함", () => {
      expect(() => parseCanonicalModelRef("openai/")).toThrow();
    });
    it("modelId가 공백이면 throw함을 검증함", () => {
      expect(() => parseCanonicalModelRef("openai/   ")).toThrow();
    });
    it("잘못된 effort이면 throw함을 검증함", () => {
      expect(() => parseCanonicalModelRef("openai/gpt-4o#invalid")).toThrow(/Invalid effort/);
    });
    it("modelId 안의 slash를 처리함을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt/4o")).toEqual({
        provider: "openai",
        modelId: "gpt/4o",
      });
    });
  });

  describe("formatModelRef 동작을 검증함", () => {
    it("effort 없이 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o")).toBe("openai/gpt-4o"));
    it("thinking과 함께 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o", "high")).toBe("openai/gpt-4o#high"));
    it("off와 함께 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o", "off")).toBe("openai/gpt-4o#off"));
    it("thinking이 undefined면 effort 없이 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o", undefined)).toBe("openai/gpt-4o"));
  });
});
