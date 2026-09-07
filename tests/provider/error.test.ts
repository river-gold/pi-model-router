import { describe, expect, it, vi } from "vitest";
import {
  createErrorMessage,
  normalizeDelegateError,
  pushStreamError,
} from "../../src/provider/error";
import type { Model, Api } from "@earendil-works/pi-ai";

const makeModel = (): Model<Api> =>
  ({ provider: "openai", id: "gpt-4o", api: "openai" as Api }) as unknown as Model<Api>;

const makeStream = () => {
  const push = vi.fn();
  const end = vi.fn();
  return { push, end } as unknown as { push: (e: unknown) => void; end: () => void };
};

describe("provider/error 에러 처리", () => {
  describe("createErrorMessage 에러 메시지 생성", () => {
    it("message와 timestamp로 생성", () => {
      const m = makeModel();
      const msg = createErrorMessage(m, "fail");
      expect(msg.errorMessage).toBe("fail");
      expect(msg.provider).toBe("openai");
      expect(msg.model).toBe("gpt-4o");
      expect(msg.stopReason).toBe("error");
      expect(typeof msg.timestamp).toBe("number");
    });
  });

  describe("normalizeDelegateError 위임 에러 정규화", () => {
    it("같은 Error 반환", () => {
      const e = new Error("orig");
      expect(normalizeDelegateError(e)).toBe(e);
    });
    it("string 감싸기", () => {
      const e = normalizeDelegateError("string error");
      expect(e.message).toBe("string error");
    });
    it("number와 기타 값 감싸기", () => {
      expect(normalizeDelegateError(123).message).toBe(
        "Failed to delegate to any model in the chain.",
      );
      expect(normalizeDelegateError(undefined).message).toBe(
        "Failed to delegate to any model in the chain.",
      );
      expect(normalizeDelegateError(null).message).toBe(
        "Failed to delegate to any model in the chain.",
      );
      expect(normalizeDelegateError({}).message).toBe(
        "Failed to delegate to any model in the chain.",
      );
    });
  });

  describe("pushStreamError 스트림 에러 전송", () => {
    it("aborted 처리", () => {
      const s = makeStream();
      const { push, end } = s;
      pushStreamError(s, makeModel(), new Error("aborted"));
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "done",
          reason: "stop",
          message: expect.objectContaining({ errorMessage: "aborted" }),
        }),
      );
      expect(end).toHaveBeenCalled();
    });

    it("stale 처리", () => {
      const s = makeStream();
      const { push, end } = s;
      pushStreamError(s, makeModel(), new Error("stale context"));
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "done",
          reason: "stop",
          message: expect.objectContaining({ errorMessage: "" }),
        }),
      );
      expect(end).toHaveBeenCalled();
    });

    it("stale 포함 처리", () => {
      const s = makeStream();
      const { push } = s;
      pushStreamError(s, makeModel(), new Error("something stale inside"));
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }));
    });

    it("기타 Error 처리", () => {
      const s = makeStream();
      const { push, end } = s;
      pushStreamError(s, makeModel(), new Error("other fail"));
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          reason: "error",
          error: expect.objectContaining({ errorMessage: "other fail" }),
        }),
      );
      expect(end).toHaveBeenCalled();
    });

    it("non-Error string 처리", () => {
      const s = makeStream();
      const { push } = s;
      pushStreamError(s, makeModel(), "string error");
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ errorMessage: "string error" }),
        }),
      );
    });

    it("non-Error number 처리", () => {
      const s = makeStream();
      const { push } = s;
      pushStreamError(s, makeModel(), 123);
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ errorMessage: "123" }) }),
      );
    });

    it("non-Error undefined 처리", () => {
      const s = makeStream();
      const { push } = s;
      pushStreamError(s, makeModel(), undefined);
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ errorMessage: "undefined" }) }),
      );
    });
  });
});
