import { describe, expect, it } from "vitest";
import { formatModelRef, parseCanonicalModelRef } from "../../src/config/modelRef";

describe("modelRef를 검증함", () => {
  describe("parseCanonicalModelRef 동작을 검증함", () => {
    it("thinking 없이 파싱함을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
      "thinking %s와 함께 파싱함을 검증함",
      (thinking) => {
        expect(parseCanonicalModelRef(`openai/gpt-4o#${thinking}`)).toEqual({
          provider: "openai",
          modelId: "gpt-4o",
          thinking,
        });
      },
    );
    it("provider와 modelId의 공백을 제거함을 검증함", () => {
      expect(parseCanonicalModelRef(" openai / gpt-4o #high ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        thinking: "high",
      });
    });
    it("thinking 원시값의 공백을 제거함을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o# high ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        thinking: "high",
      });
    });
    it("# 뒤 thinking이 비면 thinking 없음을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o#")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it("# 뒤 공백만 있으면 thinking 없음을 검증함", () => {
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
    it("잘못된 thinking이면 throw함을 검증함", () => {
      expect(() => parseCanonicalModelRef("openai/gpt-4o#invalid")).toThrow(/Invalid thinking/);
    });
    it("modelId 안의 slash를 처리함을 검증함", () => {
      expect(parseCanonicalModelRef("openai/gpt/4o")).toEqual({
        provider: "openai",
        modelId: "gpt/4o",
      });
    });
  });

  describe("formatModelRef 동작을 검증함", () => {
    it("thinking 없이 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o")).toBe("openai/gpt-4o"));
    it("thinking과 함께 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o", "high")).toBe("openai/gpt-4o#high"));
    it("off와 함께 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o", "off")).toBe("openai/gpt-4o#off"));
    it("thinking이 undefined면 thinking 없이 포맷함을 검증함", () =>
      expect(formatModelRef("openai", "gpt-4o", undefined)).toBe("openai/gpt-4o"));
  });
});
