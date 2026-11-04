import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../src/context/tokens";

describe("tokens 토큰 추정", () => {
  it("빈 문자열은 0을 반환한다", () => expect(estimateTokens("")).toBe(0));
  it("1 char는 1을 반환한다", () => expect(estimateTokens("a")).toBe(1));
  it("3 chars는 1을 반환한다", () => expect(estimateTokens("abc")).toBe(1));
  it("4 chars는 2를 반환한다", () => expect(estimateTokens("abcd")).toBe(2));
  it("6 chars는 2를 반환한다", () => expect(estimateTokens("a".repeat(6))).toBe(2));
  it("7 chars는 3을 반환한다", () => expect(estimateTokens("a".repeat(7))).toBe(3));
  it("9 chars는 정확히 3을 반환한다", () => expect(estimateTokens("a".repeat(9))).toBe(3));
});
