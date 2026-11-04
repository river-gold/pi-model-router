import { describe, expect, it, vi } from "vitest";
import {
  createErrorMessage,
  normalizeDelegateError,
  pushStreamError,
} from "../../src/provider/error";
import { makeFakeModel, makeStreamSpy } from "../helpers";

describe("provider/error 에러 처리", () => {
  describe("createErrorMessage 에러 메시지 생성", () => {
    it("message와 timestamp로 생성", () => {
      const m = makeFakeModel({ id: "gpt-4o" });
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
      const { stream, push } = makeStreamSpy();
      const endSpy = vi.spyOn(stream, "end");
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), new Error("aborted"));
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "done",
          reason: "stop",
          message: expect.objectContaining({ errorMessage: "aborted" }),
        }),
      );
      expect(endSpy).toHaveBeenCalled();
    });

    it("stale 처리", () => {
      const { stream, push } = makeStreamSpy();
      const endSpy = vi.spyOn(stream, "end");
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), new Error("stale context"));
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "done",
          reason: "stop",
          message: expect.objectContaining({ errorMessage: "" }),
        }),
      );
      expect(endSpy).toHaveBeenCalled();
    });

    it("stale 포함 처리", () => {
      const { stream, push } = makeStreamSpy();
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), new Error("something stale inside"));
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }));
    });

    it("기타 Error 처리", () => {
      const { stream, push } = makeStreamSpy();
      const endSpy = vi.spyOn(stream, "end");
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), new Error("other fail"));
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          reason: "error",
          error: expect.objectContaining({ errorMessage: "other fail" }),
        }),
      );
      expect(endSpy).toHaveBeenCalled();
    });

    it("non-Error string 처리", () => {
      const { stream, push } = makeStreamSpy();
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), "string error");
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ errorMessage: "string error" }),
        }),
      );
    });

    it("non-Error number 처리", () => {
      const { stream, push } = makeStreamSpy();
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), 123);
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ errorMessage: "123" }) }),
      );
    });

    it("non-Error undefined 처리", () => {
      const { stream, push } = makeStreamSpy();
      pushStreamError(stream, makeFakeModel({ id: "gpt-4o" }), undefined);
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ errorMessage: "undefined" }) }),
      );
    });
  });
});
