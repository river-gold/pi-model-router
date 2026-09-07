import { describe, expect, it } from "vitest";
import {
  isAbortedOrStaleMessage,
  isNonRetryableMessage,
  isRecordablePreStreamError,
  matchesRecordablePattern,
} from "../../src/failureMemory/isRecordable";
import { RECORDABLE_PATTERNS } from "../../src/failureMemory/constants";

describe("failureMemory/isRecordable 기록 가능 판별", () => {
  describe("isNonRetryableMessage 재시도 불가 메시지 판별", () => {
    it("NON_RETRYABLE 접두사면 true를 반환한다", () => {
      expect(isNonRetryableMessage("NON_RETRYABLE: foo")).toBe(true);
      expect(isNonRetryableMessage("NON_RETRYABLE:")).toBe(true);
    });
    it("그 외에는 false를 반환한다", () => {
      expect(isNonRetryableMessage("")).toBe(false);
      expect(isNonRetryableMessage("some error")).toBe(false);
      expect(isNonRetryableMessage("non-retryable")).toBe(false);
    });
  });

  describe("isAbortedOrStaleMessage 중단·만료 메시지 판별", () => {
    it("aborted 메시지면 true를 반환한다", () => {
      expect(isAbortedOrStaleMessage("aborted")).toBe(true);
      expect(isAbortedOrStaleMessage("request aborted by user")).toBe(true);
    });
    it("stale 메시지면 true를 반환한다", () => {
      expect(isAbortedOrStaleMessage("stale")).toBe(true);
      expect(isAbortedOrStaleMessage("stale context")).toBe(true);
    });
    it("그 외에는 false를 반환한다", () => {
      expect(isAbortedOrStaleMessage("")).toBe(false);
      expect(isAbortedOrStaleMessage("some error")).toBe(false);
      expect(isAbortedOrStaleMessage("Aborted")).toBe(false); // case sensitive
    });
  });

  describe("matchesRecordablePattern 기록 패턴 매칭", () => {
    it("각 패턴을 매칭한다", () => {
      const cases: [string, boolean][] = [
        ["Routed model not found", true],
        ["No API key", true],
        ["Auth failed", true],
        ["429", false],
        ["rate limit exceeded", false],
        ["503 overloaded", false],
        ["Model failed before sending content", false],
        ["No delegated stream", false],
        ["some random error", false],
        ["", false],
      ];
      for (const [msg, expected] of cases) {
        expect(matchesRecordablePattern(msg)).toBe(expected);
      }
    });

    it("모든 RECORDABLE_PATTERNS를 포함한다", () => {
      expect(RECORDABLE_PATTERNS.length).toBe(3);
      for (const p of RECORDABLE_PATTERNS) {
        // ensure pattern is RegExp
        expect(p instanceof RegExp).toBe(true);
      }
    });
  });

  describe("isRecordablePreStreamError 스트림 전 에러 기록 판별", () => {
    it("Error가 아니면 false를 반환한다", () => {
      expect(isRecordablePreStreamError("string" as unknown as Error)).toBe(false);
      expect(isRecordablePreStreamError(null as unknown as Error)).toBe(false);
      expect(isRecordablePreStreamError(undefined as unknown as Error)).toBe(false);
      expect(isRecordablePreStreamError({ message: "hello" } as unknown as Error)).toBe(false);
    });
    it("빈 메시지면 false를 반환한다", () => {
      expect(isRecordablePreStreamError(new Error(""))).toBe(false);
      expect(isRecordablePreStreamError(new Error())).toBe(false); // message is ""
    });
    it("aborted·stale이면 false를 반환한다", () => {
      expect(isRecordablePreStreamError(new Error("aborted"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("stale context"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("request aborted"))).toBe(false);
    });
    it("NON_RETRYABLE이면 false를 반환한다", () => {
      expect(isRecordablePreStreamError(new Error("NON_RETRYABLE: foo"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("NON_RETRYABLE:"))).toBe(false);
    });
    it("기록 가능한 패턴의 Error면 true를 반환한다", () => {
      expect(isRecordablePreStreamError(new Error("Routed model not found: x"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("No API key for x"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("Auth failed"))).toBe(true);
      expect(isRecordablePreStreamError(new Error("429"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("503 overloaded"))).toBe(false);
    });
    it("기록 불가한 Error면 false를 반환한다", () => {
      expect(isRecordablePreStreamError(new Error("some random error"))).toBe(false);
      expect(isRecordablePreStreamError(new Error("hello world"))).toBe(false);
    });
  });
});
