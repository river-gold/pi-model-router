import { describe, expect, it, vi } from "vitest";
import { safePersist, safeUpdateStatus } from "../../src/provider/safe";

describe("provider/safe", () => {
  describe("safeUpdateStatus", () => {
    it("calls when lastExtensionContext exists", () => {
      const ctx = { ui: {} } as any;
      const state = { lastExtensionContext: ctx } as any;
      const actions = { updateStatus: vi.fn() };
      safeUpdateStatus(state, actions);
      expect(actions.updateStatus).toHaveBeenCalledWith(ctx);
    });

    it("does not call when no context", () => {
      const state = { lastExtensionContext: undefined } as any;
      const actions = { updateStatus: vi.fn() };
      safeUpdateStatus(state, actions);
      expect(actions.updateStatus).not.toHaveBeenCalled();
    });

    it("swallows throw from updateStatus", () => {
      const ctx = {} as any;
      const state = { lastExtensionContext: ctx } as any;
      const actions = {
        updateStatus: vi.fn().mockImplementation(() => {
          throw new Error("stale");
        }),
      };
      expect(() => safeUpdateStatus(state, actions)).not.toThrow();
    });

    it("swallows throw when no context but updateStatus throws? not called", () => {
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

  describe("safePersist", () => {
    it("calls persistState", () => {
      const actions = { persistState: vi.fn() };
      safePersist(actions);
      expect(actions.persistState).toHaveBeenCalled();
    });

    it("swallows throw", () => {
      const actions = {
        persistState: vi.fn().mockImplementation(() => {
          throw new Error("stale");
        }),
      };
      expect(() => safePersist(actions)).not.toThrow();
    });
  });
});
