import { describe, expect, it } from "vitest";
import { findLastUserIndex, getLastUserText } from "../../src/context/lastUser";
import type { Context, Message } from "@earendil-works/pi-ai";

describe("lastUser 마지막 user 조회", () => {
  describe("findLastUserIndex 마지막 user 인덱스 조회", () => {
    it("빈 배열이면 -1을 반환한다", () => expect(findLastUserIndex([])).toBe(-1));
    it("user가 없으면 -1을 반환한다", () =>
      expect(
        findLastUserIndex([
          { role: "assistant", content: "a" } as unknown as Message,
          { role: "toolResult", content: "t" } as unknown as Message,
        ]),
      ).toBe(-1));
    it("user가 하나면 0을 반환한다", () =>
      expect(findLastUserIndex([{ role: "user", content: "hi" } as unknown as Message])).toBe(0));
    it("마지막이 user면 해당 인덱스를 반환한다", () =>
      expect(
        findLastUserIndex([
          { role: "user", content: "u1" } as unknown as Message,
          { role: "assistant", content: "a" } as unknown as Message,
          { role: "user", content: "u2" } as unknown as Message,
        ]),
      ).toBe(2));
    it("마지막이 user가 아니면 이전 user 인덱스를 반환한다", () =>
      expect(
        findLastUserIndex([
          { role: "user", content: "u1" } as unknown as Message,
          { role: "assistant", content: "a" } as unknown as Message,
        ]),
      ).toBe(0));
    it("여러 user 중 마지막 인덱스를 반환한다", () =>
      expect(
        findLastUserIndex([
          { role: "user", content: "u1" } as unknown as Message,
          { role: "user", content: "u2" } as unknown as Message,
          { role: "assistant", content: "a" } as unknown as Message,
        ]),
      ).toBe(1));
  });

  describe("getLastUserText 마지막 user 텍스트 조회", () => {
    it("빈 메시지면 빈 문자열을 반환한다", () =>
      expect(getLastUserText({ messages: [] } as unknown as Context)).toBe(""));
    it("user가 없으면 빈 문자열을 반환한다", () =>
      expect(
        getLastUserText({
          messages: [{ role: "assistant", content: "a" } as unknown as Message],
        } as unknown as Context),
      ).toBe(""));
    it("마지막 user 텍스트를 trim해서 반환한다", () =>
      expect(
        getLastUserText({
          messages: [{ role: "user", content: "  hello  " } as unknown as Message],
        } as unknown as Context),
      ).toBe("hello"));
    it("배열 content의 마지막 user 텍스트를 반환한다", () =>
      expect(
        getLastUserText({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "  t  " } as any],
            } as unknown as Message,
          ],
        } as unknown as Context),
      ).toBe("t"));
    it("trim 후 빈 마지막 user는 빈 문자열을 반환한다", () =>
      expect(
        getLastUserText({
          messages: [{ role: "user", content: "   " } as unknown as Message],
        } as unknown as Context),
      ).toBe(""));
    it("마지막 메시지가 아니어도 마지막 user를 반환한다", () =>
      expect(
        getLastUserText({
          messages: [
            { role: "user", content: "u1" } as unknown as Message,
            { role: "assistant", content: "a" } as unknown as Message,
            { role: "user", content: "u2" } as unknown as Message,
            { role: "assistant", content: "a2" } as unknown as Message,
          ],
        } as unknown as Context),
      ).toBe("u2"));
  });
});
