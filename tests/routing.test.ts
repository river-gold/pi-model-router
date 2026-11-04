import { describe, expect, it } from "vitest";
import { thinkingToTier } from "../src/routing";

describe("thinkingToTier", () => {
  it("모든 thinking level을 같은 이름의 tier로 매핑한다", () => {
    expect(thinkingToTier("off")).toBe("off");
    expect(thinkingToTier("minimal")).toBe("minimal");
    expect(thinkingToTier("low")).toBe("low");
    expect(thinkingToTier("medium")).toBe("medium");
    expect(thinkingToTier("high")).toBe("high");
    expect(thinkingToTier("xhigh")).toBe("xhigh");
    expect(thinkingToTier("max")).toBe("max");
  });
});
