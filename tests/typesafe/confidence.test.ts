import { describe, expect, it } from "vitest";
import { applyConfidenceGate } from "../../src/typesafe/confidence";

const classification = (
  tier: "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
  confidence?: number,
) => ({
  tier,
  confidence,
  probabilities: undefined,
});

describe("applyConfidenceGate를 검증함", () => {
  it("confidence가 임계값 이상이면 선택한 tier를 유지함을 검증함", () => {
    expect(applyConfidenceGate(classification("medium", 0.5), 0.5)).toEqual({
      tier: "medium",
      reasoning: "TypeSafe chose medium (confidence 0.50).",
    });
  });

  it("confidence가 임계값보다 낮으면 한 단계 위 tier로 승격함을 검증함", () => {
    expect(applyConfidenceGate(classification("low", 0.31), 0.5)).toEqual({
      tier: "medium",
      reasoning: "TypeSafe chose low (confidence 0.31 < 0.5) → escalated to medium.",
    });
    expect(applyConfidenceGate(classification("high", 0.2), 0.5).tier).toBe("xhigh");
    expect(applyConfidenceGate(classification("minimal", 0), 0.5).tier).toBe("low");
  });

  it("confidence가 없으면 승격하지 않고 사유에 표시함을 검증함", () => {
    expect(applyConfidenceGate(classification("high", undefined), 0.5)).toEqual({
      tier: "high",
      reasoning: "TypeSafe chose high (confidence unavailable).",
    });
  });

  it("이미 최고 tier면 승격하지 않음을 검증함", () => {
    expect(applyConfidenceGate(classification("max", 0.1), 0.5)).toEqual({
      tier: "max",
      reasoning: "TypeSafe chose max (confidence 0.10 < 0.5, already the highest tier).",
    });
  });
});
