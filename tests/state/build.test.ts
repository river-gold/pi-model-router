import { describe, expect, it, vi } from "vitest";
import { buildPersistedState } from "../../src/state/build";
import type { RoutingDecision } from "../../src/types";

describe("state/build", () => {
  it("builds with all fields", () => {
    const d: RoutingDecision = {
      profile: "balanced",
      tier: "high",
      targetProvider: "google",
      targetModelId: "gemini",
      targetLabel: "google/gemini",
      reasoning: "test",
      timestamp: 123,
    };
    const s = buildPersistedState(true, "balanced", true, [d], d, "openai/gpt-4o", 1.23);
    expect(s.enabled).toBe(true);
    expect(s.selectedProfile).toBe("balanced");
    expect(s.timestamp).toBeDefined();
  });

  it("handles undefined selectedProfile", () => {
    const s = buildPersistedState(false, undefined, false, [], undefined, undefined, 0);
    expect(s.selectedProfile).toBe("");
  });

  it("handles empty string profile", () => {
    const s = buildPersistedState(true, "", false, [], undefined, undefined, 0);
    expect(s.selectedProfile).toBe("");
  });

  it("uses Date.now", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const s = buildPersistedState(false, "p", false, [], undefined, undefined, 0);
    expect(s.timestamp).toBe(now);
    vi.restoreAllMocks();
  });
});
