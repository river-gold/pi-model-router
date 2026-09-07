import { describe, expect, it, vi } from "vitest";
import { safePersist, safeUpdateStatus } from "../../src/provider/safe";

describe("provider/safe 안전 호출", () => {
  describe("safeUpdateStatus 상태 업데이트", () => {
    it("lastExtensionContext가 있으면 호출", () => {
      const ctx = { ui: {} } as any;
      const state = { lastExtensionContext: ctx } as any;
      const actions = { updateStatus: vi.fn() };
      safeUpdateStatus(state, actions);
      expect(actions.updateStatus).toHaveBeenCalledWith(ctx);
    });

    it("context가 없으면 호출 안 함", () => {
      const state = { lastExtensionContext: undefined } as any;
      const actions = { updateStatus: vi.fn() };
      safeUpdateStatus(state, actions);
      expect(actions.updateStatus).not.toHaveBeenCalled();
    });

    it("updateStatus의 throw 무시", () => {
      const ctx = {} as any;
      const state = { lastExtensionContext: ctx } as any;
      const actions = {
        updateStatus: vi.fn().mockImplementation(() => {
          throw new Error("stale");
        }),
      };
      expect(() => safeUpdateStatus(state, actions)).not.toThrow();
    });

    it("context가 없으면 updateStatus 호출 없이 throw 무시", () => {
      const state = { lastExtensionContext: null } as any;
      const actions = {
        updateStatus: vi.fn().mockImplementation(() => {
          throw new Error("x");
        }),
      };
      expect(() => safeUpdateStatus(state, actions)).not.toThrow();
      expect(actions.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("safePersist 상태 저장", () => {
    it("persistState 호출", () => {
      const actions = { persistState: vi.fn() };
      safePersist(actions);
      expect(actions.persistState).toHaveBeenCalled();
    });

    it("throw 무시", () => {
      const actions = {
        persistState: vi.fn().mockImplementation(() => {
          throw new Error("stale");
        }),
      };
      expect(() => safePersist(actions)).not.toThrow();
    });
  });
});
