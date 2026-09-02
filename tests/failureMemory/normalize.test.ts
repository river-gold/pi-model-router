import { describe, expect, it } from "vitest";
import { chainKeyForRoute, normalizeFailedRef } from "../../src/failureMemory/normalize";
import { CLASSIFIER_CHAIN_KEY } from "../../src/failureMemory/constants";

describe("failureMemory/normalize", () => {
  it("chainKeyForRoute", () => {
    expect(chainKeyForRoute("balanced", "high")).toBe("route:balanced:high");
    expect(chainKeyForRoute("", "")).toBe("route::");
    expect(chainKeyForRoute("p", "minimal")).toBe("route:p:minimal");
  });
  it("normalizeFailedRef trims", () => {
    expect(normalizeFailedRef(" openai/gpt-4 ")).toBe("openai/gpt-4");
    expect(normalizeFailedRef("")).toBe("");
    expect(normalizeFailedRef("   ")).toBe("");
    expect(normalizeFailedRef("a\n")).toBe("a");
    expect(normalizeFailedRef("\t abc \t")).toBe("abc");
  });
  it("CLASSIFIER_CHAIN_KEY", () => {
    expect(CLASSIFIER_CHAIN_KEY).toBe("classifier");
  });
});
