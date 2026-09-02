import { describe, expect, it } from "vitest";
import { isEqualPersistedState } from "../../src/state/equality";

describe("state/equality", () => {
  it("true when equal", () => expect(isEqualPersistedState("a", "a")).toBe(true));
  it("false when not equal", () => expect(isEqualPersistedState("a", "b")).toBe(false));
  it("false when prev undefined", () => expect(isEqualPersistedState(undefined, "a")).toBe(false));
  it("true when both undefined? no, second is string", () =>
    expect(isEqualPersistedState(undefined, "")).toBe(false));
});
