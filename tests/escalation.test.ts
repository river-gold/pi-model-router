import { describe, it, expect } from "vitest";
import { isEscalationCall, validateEscalationLevel, ESCALATION_TOOL_NAME } from "../src/escalation";

describe("escalation", () => {
  it("isEscalationCall", () => {
    expect(isEscalationCall(ESCALATION_TOOL_NAME)).toBe(true);
    expect(isEscalationCall("other")).toBe(false);
  });
  it("validateEscalationLevel", () => {
    expect(validateEscalationLevel("high")).toBe("high");
    expect(validateEscalationLevel(" HIGH ")).toBe("high");
    expect(validateEscalationLevel("invalid")).toBeUndefined();
    expect(validateEscalationLevel(123)).toBeUndefined();
    expect(validateEscalationLevel(undefined)).toBeUndefined();
  });
});
