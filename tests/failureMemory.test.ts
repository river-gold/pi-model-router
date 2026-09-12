import { describe, it, expect } from "vitest";
import {
  isRecordablePreStreamError,
  normalizeFailedRef,
  chainKeyForRoute,
  CLASSIFIER_CHAIN_KEY,
} from "../src/failureMemory";

describe("failureMemory 실패 기억은", () => {
  it("normalize은 앞뒤 공백을 제거한다", () => {
    expect(normalizeFailedRef(" openai/gpt-4 ")).toBe("openai/gpt-4");
  });
  it("chainKey는 키를 생성한다", () => {
    expect(chainKeyForRoute("balanced", "high")).toBe("route:balanced:high");
    expect(CLASSIFIER_CHAIN_KEY).toBe("classifier");
  });
  it("auth/notfound 에러만 isRecordable이 true이다", () => {
    expect(isRecordablePreStreamError(new Error("Routed model not found: openai/gpt-4"))).toBe(
      true,
    );
    expect(isRecordablePreStreamError(new Error("No API key for routed model: openai/gpt-4"))).toBe(
      true,
    );
    expect(
      isRecordablePreStreamError(new Error("Auth failed for routed model: openai/gpt-4: 401")),
    ).toBe(true);
    expect(isRecordablePreStreamError(new Error("429 rate limit exceeded"))).toBe(false);
    expect(isRecordablePreStreamError(new Error("503 Server error"))).toBe(false);
    expect(isRecordablePreStreamError(new Error("Model failed before sending content."))).toBe(
      false,
    );
    expect(isRecordablePreStreamError(new Error("No delegated stream available"))).toBe(false);
  });
  it("aborted/stale/NON_RETRYABLE은 isRecordable이 false이다", () => {
    expect(isRecordablePreStreamError(new Error("aborted"))).toBe(false);
    expect(isRecordablePreStreamError(new Error("stale context"))).toBe(false);
    expect(
      isRecordablePreStreamError(new Error("NON_RETRYABLE: Model failed after sending content.")),
    ).toBe(false);
  });
  it("non-error나 일반 메시지는 isRecordable이 false이다", () => {
    expect(isRecordablePreStreamError(new Error("some random error"))).toBe(false);
    expect(isRecordablePreStreamError("string")).toBe(false);
  });
});
