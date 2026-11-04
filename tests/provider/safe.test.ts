import { describe, expect, it, vi } from "vitest";
import { safePersist, safeUpdateStatus } from "../../src/provider/safe";
import { makeFakeExtensionContext, makeFakeProviderState } from "../helpers";

describe("provider/safe 안전 호출", () => {
  describe("safeUpdateStatus 상태 업데이트", () => {
    it("lastExtensionContext가 있으면 호출", () => {
      const ctx = makeFakeExtensionContext();
      const state = makeFakeProviderState({ lastExtensionContext: ctx });
      const actions = { updateStatus: vi.fn() };
      safeUpdateStatus(state, actions);
      expect(actions.updateStatus).toHaveBeenCalledWith(ctx);
    });

    it("context가 없으면 호출 안 함", () => {
      const state = makeFakeProviderState({ lastExtensionContext: undefined });
      const actions = { updateStatus: vi.fn() };
      safeUpdateStatus(state, actions);
      expect(actions.updateStatus).not.toHaveBeenCalled();
    });

    it("updateStatus의 throw 무시", () => {
      const ctx = makeFakeExtensionContext();
      const state = makeFakeProviderState({ lastExtensionContext: ctx });
      const actions = {
        updateStatus: vi.fn(() => {
          throw new Error("stale");
        }),
      };
      expect(() => safeUpdateStatus(state, actions)).not.toThrow();
    });

    it("context가 없으면 updateStatus 호출 없이 throw 무시", () => {
      const state = makeFakeProviderState({ lastExtensionContext: undefined });
      const actions = {
        updateStatus: vi.fn(() => {
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
        persistState: vi.fn(() => {
          throw new Error("stale");
        }),
      };
      expect(() => safePersist(actions)).not.toThrow();
    });
  });
});
