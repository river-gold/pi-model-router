import { describe, expect, it } from "vitest";
import { findLastUserIndex, getLastUserText } from "../../src/context/lastUser";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { fakeMessage } from "../helpers";

const user = (content: UserMessage["content"]): Message => ({
  role: "user",
  content,
  timestamp: 0,
});

const assistant = (text: string): Message => fakeMessage({ content: [{ type: "text", text }] });

const toolResult = (text: string): Message => ({
  role: "toolResult",
  content: [{ type: "text", text }],
  toolCallId: "1",
  toolName: "t",
  isError: false,
  timestamp: 0,
});

describe("lastUser 마지막 user 조회", () => {
  describe("findLastUserIndex 마지막 user 인덱스 조회", () => {
    it("빈 배열이면 -1을 반환한다", () => expect(findLastUserIndex([])).toBe(-1));
    it("user가 없으면 -1을 반환한다", () =>
      expect(findLastUserIndex([assistant("a"), toolResult("t")])).toBe(-1));
    it("user가 하나면 0을 반환한다", () => expect(findLastUserIndex([user("hi")])).toBe(0));
    it("마지막이 user면 해당 인덱스를 반환한다", () =>
      expect(findLastUserIndex([user("u1"), assistant("a"), user("u2")])).toBe(2));
    it("마지막이 user가 아니면 이전 user 인덱스를 반환한다", () =>
      expect(findLastUserIndex([user("u1"), assistant("a")])).toBe(0));
    it("여러 user 중 마지막 인덱스를 반환한다", () =>
      expect(findLastUserIndex([user("u1"), user("u2"), assistant("a")])).toBe(1));
  });

  describe("getLastUserText 마지막 user 텍스트 조회", () => {
    it("빈 메시지면 빈 문자열을 반환한다", () =>
      expect(getLastUserText({ messages: [] })).toBe(""));
    it("user가 없으면 빈 문자열을 반환한다", () =>
      expect(
        getLastUserText({
          messages: [assistant("a")],
        }),
      ).toBe(""));
    it("마지막 user 텍스트를 trim해서 반환한다", () =>
      expect(
        getLastUserText({
          messages: [user("  hello  ")],
        }),
      ).toBe("hello"));
    it("배열 content의 마지막 user 텍스트를 반환한다", () =>
      expect(
        getLastUserText({
          messages: [user([{ type: "text", text: "  t  " }])],
        }),
      ).toBe("t"));
    it("trim 후 빈 마지막 user는 빈 문자열을 반환한다", () =>
      expect(
        getLastUserText({
          messages: [user("   ")],
        }),
      ).toBe(""));
    it("마지막 메시지가 아니어도 마지막 user를 반환한다", () =>
      expect(
        getLastUserText({
          messages: [user("u1"), assistant("a"), user("u2"), assistant("a2")],
        }),
      ).toBe("u2"));
  });
});
