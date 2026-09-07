import { describe, expect, it } from "vitest";
import { isObjectRecord, isRouterTier } from "../../src/config/guards";

describe("guards를 검증함", () => {
  describe("isObjectRecord 동작을 검증함", () => {
    it("일반 object는 true 반환함을 검증함", () => expect(isObjectRecord({})).toBe(true));
    it("키 있는 object는 true 반환함을 검증함", () => expect(isObjectRecord({ a: 1 })).toBe(true));
    it("null은 false 반환함을 검증함", () => expect(isObjectRecord(null)).toBe(false));
    it("array는 false 반환함을 검증함", () => expect(isObjectRecord([])).toBe(false));
    it("number는 false 반환함을 검증함", () => expect(isObjectRecord(42)).toBe(false));
    it("string은 false 반환함을 검증함", () => expect(isObjectRecord("a")).toBe(false));
    it("undefined는 false 반환함을 검증함", () => expect(isObjectRecord(undefined)).toBe(false));
    it("boolean은 false 반환함을 검증함", () => expect(isObjectRecord(true)).toBe(false));
  });

  describe("isRouterTier 동작을 검증함", () => {
    it.each(["max", "xhigh", "high", "medium", "low", "minimal"] as const)("%s는 true 반환함을 검증함", (t) =>
      expect(isRouterTier(t)).toBe(true),
    );
    it("auto는 false 반환함을 검증함", () => expect(isRouterTier("auto")).toBe(false));
    it("빈 문자열은 false 반환함을 검증함", () => expect(isRouterTier("")).toBe(false));
    it("null은 false 반환함을 검증함", () => expect(isRouterTier(null)).toBe(false));
    it("undefined는 false 반환함을 검증함", () => expect(isRouterTier(undefined)).toBe(false));
    it("number는 false 반환함을 검증함", () => expect(isRouterTier(123)).toBe(false));
    it("공백 포함 문자열은 false 반환함을 검증함", () => expect(isRouterTier("high ")).toBe(false));
  });
});
