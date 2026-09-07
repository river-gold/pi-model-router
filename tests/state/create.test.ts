import { describe, expect, it } from "vitest";
import { createRouterState } from "../../src/state/create";

describe("state/create 모듈", () => {
  it("기본값을 생성한다", () => {
    const s = createRouterState();
    expect(s.currentConfig).toEqual({ profiles: {} });
    expect(s.currentModelRegistry).toBeUndefined();
    expect(s.routerEnabled).toBe(false);
    expect(s.selectedProfile).toBeUndefined();
    expect(s.failedByChain).toBeInstanceOf(Map);
    expect(s.isInitialized).toBe(false);
    expect(s.isInternalModelSwitch).toBe(0);
    expect(typeof s.currentCwd).toBe("string");
  });

  it("매번 새로운 map을 생성한다", () => {
    const a = createRouterState();
    const b = createRouterState();
    expect(a.failedByChain).not.toBe(b.failedByChain);
  });
});
