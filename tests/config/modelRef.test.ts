import { describe, expect, it } from "vitest";
import { formatModelRef, parseCanonicalModelRef } from "../../src/config/modelRef";

describe("modelRef", () => {
  describe("parseCanonicalModelRef", () => {
    it("parses without thinking", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
      "parses with thinking %s",
      (thinking) => {
        expect(parseCanonicalModelRef(`openai/gpt-4o#${thinking}`)).toEqual({
          provider: "openai",
          modelId: "gpt-4o",
          thinking,
        });
      },
    );
    it("trims provider and modelId", () => {
      expect(parseCanonicalModelRef(" openai / gpt-4o #high ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        thinking: "high",
      });
    });
    it("trims thinking raw", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o# high ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
        thinking: "high",
      });
    });
    it("hash but empty thinking -> no thinking", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o#")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it("hash with spaces only -> no thinking", () => {
      expect(parseCanonicalModelRef("openai/gpt-4o#   ")).toEqual({
        provider: "openai",
        modelId: "gpt-4o",
      });
    });
    it("throws missing slash", () => {
      expect(() => parseCanonicalModelRef("gpt-4o")).toThrow(/Expected "provider\/model/);
    });
    it("throws provider empty", () => {
      expect(() => parseCanonicalModelRef("/gpt-4o")).toThrow();
    });
    it("throws modelId empty", () => {
      expect(() => parseCanonicalModelRef("openai/")).toThrow();
    });
    it("throws modelId whitespace", () => {
      expect(() => parseCanonicalModelRef("openai/   ")).toThrow();
    });
    it("throws invalid thinking", () => {
      expect(() => parseCanonicalModelRef("openai/gpt-4o#invalid")).toThrow(/Invalid thinking/);
    });
    it("handles slash in modelId", () => {
      expect(parseCanonicalModelRef("openai/gpt/4o")).toEqual({
        provider: "openai",
        modelId: "gpt/4o",
      });
    });
  });

  describe("formatModelRef", () => {
    it("without thinking", () => expect(formatModelRef("openai", "gpt-4o")).toBe("openai/gpt-4o"));
    it("with thinking", () => expect(formatModelRef("openai", "gpt-4o", "high")).toBe("openai/gpt-4o#high"));
    it("with off", () => expect(formatModelRef("openai", "gpt-4o", "off")).toBe("openai/gpt-4o#off"));
    it("without thinking undefined", () =>
      expect(formatModelRef("openai", "gpt-4o", undefined)).toBe("openai/gpt-4o"));
  });
});
