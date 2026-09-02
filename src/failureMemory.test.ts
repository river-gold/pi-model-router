/* oxlint-disable */
import { describe, it, expect } from "vitest";
import {
  isRecordablePreStreamError,
  normalizeFailedRef,
  chainKeyForRoute,
  CLASSIFIER_CHAIN_KEY,
} from "./failureMemory";

describe("failureMemory", () => {
  it("normalize trims", () => {
    expect(normalizeFailedRef(" openai/gpt-4 ")).toBe("openai/gpt-4");
  });
  it("chainKey", () => {
    expect(chainKeyForRoute("balanced", "high")).toBe("route:balanced:high");
    expect(CLASSIFIER_CHAIN_KEY).toBe("classifier");
  });
  it("isRecordable true for 429/5xx/auth/notfound", () => {
    expect(isRecordablePreStreamError(new Error("Routed model not found: openai/gpt-4"))).toBe(
      true,
    );
    expect(isRecordablePreStreamError(new Error("No API key for routed model: openai/gpt-4"))).toBe(
      true,
    );
    expect(
      isRecordablePreStreamError(new Error("Auth failed for routed model: openai/gpt-4: 401")),
    ).toBe(true);
    expect(isRecordablePreStreamError(new Error("429 rate limit exceeded"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("503 Server error"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("Model failed before sending content."))).toBe(
      true,
    );
    expect(isRecordablePreStreamError(new Error("No delegated stream available"))).toBe(true);
  });
  it("isRecordable false for aborted/stale/NON_RETRYABLE", () => {
    expect(isRecordablePreStreamError(new Error("aborted"))).toBe(false);
    expect(isRecordablePreStreamError(new Error("stale context"))).toBe(false);
    expect(
      isRecordablePreStreamError(new Error("NON_RETRYABLE: Model failed after sending content.")),
    ).toBe(false);
  });
  it("isRecordable false for non-error or generic message", () => {
    expect(isRecordablePreStreamError(new Error("some random error"))).toBe(false);
    expect(isRecordablePreStreamError("string" as unknown as Error)).toBe(false);
  });
});
