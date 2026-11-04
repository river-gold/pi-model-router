import { describe, expect, it, vi } from "vitest";
import { buildPersistedState } from "../../src/state/build";
import type { RoutingDecision } from "../../src/types";

describe("state/build 모듈", () => {
  it("모든 필드로 빌드한다", () => {
    const d: RoutingDecision = {
      router: "balanced",
      tier: "high",
      targetProvider: "google",
      targetModelId: "gemini",
      targetLabel: "google/gemini",
      reasoning: "test",
      timestamp: 123,
    };
    const s = buildPersistedState(true, "balanced", true, [d], d, "openai/gpt-4o", 1.23);
    expect(s.enabled).toBe(true);
    expect(s.selectedRouter).toBe("balanced");
    expect(s.timestamp).toBeDefined();
  });

  it("selectedRouter이 undefined인 경우를 처리한다", () => {
    const s = buildPersistedState(false, undefined, false, [], undefined, undefined, 0);
    expect(s.selectedRouter).toBe("");
  });

  it("빈 문자열 router을 처리한다", () => {
    const s = buildPersistedState(true, "", false, [], undefined, undefined, 0);
    expect(s.selectedRouter).toBe("");
  });

  it("Date.now를 사용한다", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const s = buildPersistedState(false, "p", false, [], undefined, undefined, 0);
    expect(s.timestamp).toBe(now);
    vi.restoreAllMocks();
  });
});
