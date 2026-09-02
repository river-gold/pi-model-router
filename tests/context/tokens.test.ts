import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../src/context/tokens";

describe("tokens", () => {
  it("empty", () => expect(estimateTokens("")).toBe(0));
  it("1 char", () => expect(estimateTokens("a")).toBe(1));
  it("3 chars -> 1", () => expect(estimateTokens("abc")).toBe(1));
  it("4 chars -> 2", () => expect(estimateTokens("abcd")).toBe(2));
  it("6 chars -> 2", () => expect(estimateTokens("a".repeat(6))).toBe(2));
  it("7 chars -> 3", () => expect(estimateTokens("a".repeat(7))).toBe(3));
  it("exact", () => expect(estimateTokens("a".repeat(9))).toBe(3));
});
