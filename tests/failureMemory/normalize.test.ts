import { describe, expect, it } from "vitest";
import { chainKeyForRoute, normalizeFailedRef } from "../../src/failureMemory/normalize";
import { CLASSIFIER_CHAIN_KEY } from "../../src/failureMemory/constants";

describe("failureMemory/normalize 정규화", () => {
  it("route의 chain 키를 생성한다", () => {
    expect(chainKeyForRoute("balanced", "high")).toBe("route:balanced:high");
    expect(chainKeyForRoute("", "")).toBe("route::");
    expect(chainKeyForRoute("p", "minimal")).toBe("route:p:minimal");
  });
  it("실패 ref의 공백을 제거한다", () => {
    expect(normalizeFailedRef(" openai/gpt-4 ")).toBe("openai/gpt-4");
    expect(normalizeFailedRef("")).toBe("");
    expect(normalizeFailedRef("   ")).toBe("");
    expect(normalizeFailedRef("a\n")).toBe("a");
    expect(normalizeFailedRef("\t abc \t")).toBe("abc");
  });
  it("CLASSIFIER_CHAIN_KEY 값을 확인한다", () => {
    expect(CLASSIFIER_CHAIN_KEY).toBe("classifier");
  });
});
