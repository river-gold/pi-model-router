import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRateLimitCooldowns,
  errorText,
  failedRefsForChain,
  failureCooldownUntil,
  liveRateLimitedRefs,
  RATE_LIMIT_COOLDOWN_MS,
  recordRateLimitCooldown,
  rememberPreStreamFailure,
} from "../../src/failureMemory";

describe("failureMemory/cooldown 쿨다운 관리", () => {
  afterEach(() => {
    clearRateLimitCooldowns();
  });

  it("에러를 문자열로 변환한다", () => {
    expect(errorText("raw")).toBe("raw");
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText({ message: "obj" })).toBe('{"message":"obj"}');
    expect(errorText(7)).toBe("7");
  });

  it("rate-limit 에러만 쿨다운한다", () => {
    const now = Date.parse("2026-09-06T13:00:00.000Z");
    expect(failureCooldownUntil("503 overloaded", now)).toBeNull();
    expect(failureCooldownUntil(new Error("aborted"), now)).toBeNull();
    expect(failureCooldownUntil("429", now)).toBe(now + RATE_LIMIT_COOLDOWN_MS);
    const limited =
      '429: {"message":"limit resets at 2026-09-06T13:31:13.576Z.","type":"rate_limit_error","code":"RATE_LIMITED"}';
    expect(failureCooldownUntil(limited, now)).toBe(Date.parse("2026-09-06T13:31:13.576Z"));
    expect(failureCooldownUntil("resets at 2026-13-99T99:99:99Z RATE_LIMITED", now)).toBe(
      now + RATE_LIMIT_COOLDOWN_MS,
    );
    expect(
      failureCooldownUntil("rate_limit_error resets at 2026-09-06T12:00:00.000Z", now),
    ).toBeNull();
  });

  it("만료까지 rate-limit된 ref만 제외한다", () => {
    const now = 1_000;
    recordRateLimitCooldown("route:p:high", " commandcode/m ", now + 10);
    recordRateLimitCooldown("route:p:high", "commandcode/m", now + 5);
    expect([...liveRateLimitedRefs("route:p:high", now)]).toEqual(["commandcode/m"]);
    expect(liveRateLimitedRefs("route:other:high", now).size).toBe(0);
    expect(liveRateLimitedRefs("route:p:high", now + 10).size).toBe(0);
  });

  it("세션 실패와 실시간 쿨다운을 병합한다", () => {
    expect(failedRefsForChain(undefined, "c")).toBeUndefined();
    expect(failedRefsForChain(new Set(), "c")).toBeUndefined();
    expect([...failedRefsForChain(new Set(["a"]), "none")!]).toEqual(["a"]);
    recordRateLimitCooldown("c", "b", Date.now() + 60_000);
    expect([...failedRefsForChain(undefined, "c")!]).toEqual(["b"]);
    expect([...failedRefsForChain(new Set(["a"]), "c")!].sort()).toEqual(["a", "b"]);
  });

  it("429는 쿨다운으로, auth 실패는 세션 실패로 기억한다", () => {
    const rec = vi.fn();
    rememberPreStreamFailure(new Error("503 overloaded"), "opencode-go/m", rec, "c");
    expect(rec).not.toHaveBeenCalled();
    rememberPreStreamFailure(
      new Error("429 RATE_LIMITED resets at 2099-01-01T00:00:00.000Z"),
      "commandcode/m",
      rec,
      "c",
    );
    expect(rec).not.toHaveBeenCalled();
    expect(liveRateLimitedRefs("c").has("commandcode/m")).toBe(true);
    rememberPreStreamFailure(new Error("Auth failed"), "openai/m", rec, "c");
    expect(rec).toHaveBeenCalledWith("openai/m");
  });
});
