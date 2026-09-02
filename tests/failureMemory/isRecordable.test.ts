import { describe, expect, it } from "vitest";
import {
  isAbortedOrStaleMessage,
  isNonRetryableMessage,
  isRecordablePreStreamError,
  matchesRecordablePattern,
} from "../../src/failureMemory/isRecordable";
import { RECORDABLE_PATTERNS } from "../../src/failureMemory/constants";

describe("failureMemory/isRecordable", () => {
  describe("isNonRetryableMessage", () => {
    it("true for NON_RETRYABLE prefix", () => {
      expect(isNonRetryableMessage("NON_RETRYABLE: foo")).toBe(true);
      expect(isNonRetryableMessage("NON_RETRYABLE:")).toBe(true);
    });
    it("false otherwise", () => {
      expect(isNonRetryableMessage("")).toBe(false);
      expect(isNonRetryableMessage("some error")).toBe(false);
      expect(isNonRetryableMessage("non-retryable")).toBe(false);
    });
  });

  describe("isAbortedOrStaleMessage", () => {
    it("true for aborted", () => {
      expect(isAbortedOrStaleMessage("aborted")).toBe(true);
      expect(isAbortedOrStaleMessage("request aborted by user")).toBe(true);
    });
    it("true for stale", () => {
      expect(isAbortedOrStaleMessage("stale")).toBe(true);
      expect(isAbortedOrStaleMessage("stale context")).toBe(true);
    });
    it("false otherwise", () => {
      expect(isAbortedOrStaleMessage("")).toBe(false);
      expect(isAbortedOrStaleMessage("some error")).toBe(false);
      expect(isAbortedOrStaleMessage("Aborted")).toBe(false); // case sensitive
    });
  });

  describe("matchesRecordablePattern", () => {
    it("matches each pattern", () => {
      const cases: [string, boolean][] = [
        ["Routed model not found", true],
        ["No API key", true],
        ["Auth failed", true],
        ["429", true],
        ["rate limit exceeded", true],
        ["RateLimit", true],
        ["quota exceeded", true],
        ["500 server error", true],
        ["502 Bad Gateway", true],
        ["server error occurred", true],
        ["Model failed before sending content", true],
        ["No delegated stream", true],
        ["overloaded", true],
        ["unavailable", true],
        ["some random error", false],
        ["", false],
      ];
      for (const [msg, expected] of cases) {
        expect(matchesRecordablePattern(msg)).toBe(expected);
      }
    });

    it("covers all RECORDABLE_PATTERNS", () => {
      expect(RECORDABLE_PATTERNS.length).toBe(12);
      for (const p of RECORDABLE_PATTERNS) {
        // ensure pattern is RegExp
        expect(p instanceof RegExp).toBe(true);
      }
    });
  });

  describe("isRecordablePreStreamError", () => {
    it("false for non-Error", () => {
      expect(isRecordablePreStreamError("string" as unknown as Error)).toBe(false);
      expect(isRecordablePreStreamError(null as unknown as Error)).toBe(false);
      expect(isRecordablePreStreamError(undefined as unknown as Error)).toBe(false);
      expect(isRecordablePreStreamError({ message: "hello" } as unknown as Error)).toBe(false);
    });
    it("false for empty message", () => {
      expect(isRecordablePreStreamError(new Error(""))).toBe(false);
      expect(isRecordablePreStreamError(new Error())).toBe(false); // message is ""
    });
    it("false for aborted/stale", () => {
      expect(isRecordablePreStreamError(new Error("aborted"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("stale context"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("request aborted"))).toBe(false);
    });
    it("false for NON_RETRYABLE", () => {
      expect(isRecordablePreStreamError(new Error("NON_RETRYABLE: foo"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("NON_RETRYABLE:"))).toBe(false);
    });
    it("true for each recordable pattern via Error", () => {
      expect(isRecordablePreStreamError(new Error("Routed model not found: x"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("No API key for x"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("Auth failed"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("429"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("rate limit"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("quota"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("500 Internal Server Error"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("503"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("server error"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("Model failed before sending content"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("No delegated stream"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("overloaded"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("unavailable"))).toBe(true);
    });
    it("false for non-recordable Error", () => {
      expect(isRecordablePreStreamError(new Error("some random error"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("hello world"))).toBe(false);
    });
  });
});
