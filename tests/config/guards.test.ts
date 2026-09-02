import { describe, expect, it } from "vitest";
import { isObjectRecord, isRouterTier } from "../../src/config/guards";

describe("guards", () => {
  describe("isObjectRecord", () => {
    it("true for plain object", () => expect(isObjectRecord({})).toBe(true));
    it("true for object with keys", () => expect(isObjectRecord({ a: 1 })).toBe(true));
    it("false for null", () => expect(isObjectRecord(null)).toBe(false));
    it("false for array", () => expect(isObjectRecord([])).toBe(false));
    it("false for number", () => expect(isObjectRecord(42)).toBe(false));
    it("false for string", () => expect(isObjectRecord("a")).toBe(false));
    it("false for undefined", () => expect(isObjectRecord(undefined)).toBe(false));
    it("false for boolean", () => expect(isObjectRecord(true)).toBe(false));
  });

  describe("isRouterTier", () => {
    it.each(["max", "xhigh", "high", "medium", "low", "minimal"] as const)("true for %s", (t) =>
      expect(isRouterTier(t)).toBe(true),
    );
    it("false for auto", () => expect(isRouterTier("auto")).toBe(false));
    it("false for empty string", () => expect(isRouterTier("")).toBe(false));
    it("false for null", () => expect(isRouterTier(null)).toBe(false));
    it("false for undefined", () => expect(isRouterTier(undefined)).toBe(false));
    it("false for number", () => expect(isRouterTier(123)).toBe(false));
    it("false for with space", () => expect(isRouterTier("high ")).toBe(false));
  });
});
