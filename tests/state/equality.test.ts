import { describe, expect, it } from "vitest";
import { isEqualPersistedState } from "../../src/state/equality";

describe("state/equality 모듈", () => {
  it("같으면 true이다", () => expect(isEqualPersistedState("a", "a")).toBe(true));
  it("다르면 false이다", () => expect(isEqualPersistedState("a", "b")).toBe(false));
  it("prev가 undefined이면 false이다", () =>
    expect(isEqualPersistedState(undefined, "a")).toBe(false));
  it("둘 다 undefined는 아니므로 false이다", () =>
    expect(isEqualPersistedState(undefined, "")).toBe(false));
});
