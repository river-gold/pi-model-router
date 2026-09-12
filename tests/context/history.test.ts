import { describe, expect, it } from "vitest";
import {
  buildUserPosMap,
  collectUserIndices,
  findFinalTextBetween,
  getHistoryPairsText,
  getNextUserIdx,
  isAssistantOrToolResult,
  resolveHistoryUserIndices,
} from "../../src/context/history";
import type { Context, Message } from "@earendil-works/pi-ai";
import { fakeMessage } from "../helpers";

const msg = (role: "user" | "assistant", content: string): Message => {
  if (role === "user") return { role, content, timestamp: 0 };
  return fakeMessage({ content: [{ type: "text", text: content }] });
};
const toolResult = (content: string): Message => ({
  role: "toolResult",
  content: [{ type: "text", text: content }],
  toolCallId: "1",
  toolName: "t",
  isError: false,
  timestamp: 0,
});

describe("history 히스토리 조회", () => {
  describe("collectUserIndices user 인덱스 수집", () => {
    it("빈 배열은 빈 배열을 반환한다", () => expect(collectUserIndices([])).toEqual([]));
    it("user 인덱스를 수집한다", () =>
      expect(
        collectUserIndices([msg("user", "a"), msg("assistant", "b"), msg("user", "c")]),
      ).toEqual([0, 2]));
    it("user가 없으면 빈 배열을 반환한다", () =>
      expect(collectUserIndices([msg("assistant", "a"), toolResult("t")])).toEqual([]));
  });

  describe("resolveHistoryUserIndices 히스토리 user 인덱스 결정", () => {
    it("빈 배열은 빈 배열을 반환한다", () => expect(resolveHistoryUserIndices([], 2)).toEqual([]));
    it("user가 하나면 마지막을 제외해 빈 배열을 반환한다", () =>
      expect(resolveHistoryUserIndices([0], 1)).toEqual([]));
    it("pairCount 1개를 반환한다", () =>
      expect(resolveHistoryUserIndices([0, 1, 2], 1)).toEqual([1]));
    it("pairCount 2개를 반환한다", () =>
      expect(resolveHistoryUserIndices([0, 1, 2], 2)).toEqual([0, 1]));
    it("pairCount가 가용 수보다 크면 전부를 반환한다", () =>
      expect(resolveHistoryUserIndices([0, 1, 2], 10)).toEqual([0, 1]));
    it("pairCount가 정확히 맞으면 해당 구간을 반환한다", () =>
      expect(resolveHistoryUserIndices([0, 1, 2, 3], 2)).toEqual([1, 2]));
  });

  describe("isAssistantOrToolResult assistant·toolResult 판별", () => {
    it("assistant는 true를 반환한다", () =>
      expect(isAssistantOrToolResult("assistant")).toBe(true));
    it("toolResult는 true를 반환한다", () =>
      expect(isAssistantOrToolResult("toolResult")).toBe(true));
    it("user는 false를 반환한다", () => expect(isAssistantOrToolResult("user")).toBe(false));
    it("system은 false를 반환한다", () => expect(isAssistantOrToolResult("system")).toBe(false));
    it("toolCall은 false를 반환한다", () =>
      expect(isAssistantOrToolResult("toolCall")).toBe(false));
  });

  describe("getNextUserIdx 다음 user 인덱스 조회", () => {
    it("마지막이 아니면 다음 user를 반환한다", () =>
      expect(getNextUserIdx([0, 5, 10], 0, 20)).toBe(5));
    it("중간 위치에서 다음 user를 반환한다", () =>
      expect(getNextUserIdx([0, 5, 10], 1, 20)).toBe(10));
    it("마지막 위치면 messagesLength를 반환한다", () =>
      expect(getNextUserIdx([0, 5, 10], 2, 20)).toBe(20));
    it("길이가 달라도 마지막 위치면 messagesLength를 반환한다", () =>
      expect(getNextUserIdx([0], 0, 5)).toBe(5));
  });

  describe("buildUserPosMap user 위치 맵 생성", () => {
    it("빈 맵은 크기가 0이다", () => expect(buildUserPosMap([]).size).toBe(0));
    it("위치를 순서대로 매핑한다", () => {
      const m = buildUserPosMap([5, 10, 15]);
      expect(m.get(5)).toBe(0);
      expect(m.get(10)).toBe(1);
      expect(m.get(15)).toBe(2);
    });
  });

  describe("findFinalTextBetween 구간 최종 텍스트 조회", () => {
    it("assistant 응답을 찾는다", () => {
      const messages = [msg("user", "u"), msg("assistant", "a"), msg("user", "next")];
      expect(findFinalTextBetween(messages, 0, 2)).toBe("a");
    });
    it("마지막 assistant·toolResult를 우선한다", () => {
      const messages = [
        msg("user", "u"),
        msg("assistant", "a1"),
        toolResult("t1"),
        msg("user", "next"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("t1");
    });
    it("빈 응답을 건너뛴다", () => {
      const messages = [
        msg("user", "u"),
        msg("assistant", "   "),
        msg("assistant", "a"),
        msg("user", "n"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("a");
    });
    it("assistant·toolResult가 없으면 빈 문자열을 반환한다", () => {
      const messages = [msg("user", "u"), msg("user", "next2")];
      expect(findFinalTextBetween(messages, 0, 1)).toBe("");
    });
    it("user만 있으면 빈 문자열을 반환한다", () => {
      expect(findFinalTextBetween([msg("user", "u"), msg("user", "n")], 0, 1)).toBe("");
    });
    it("빈 텍스트의 assistant를 무시한다", () => {
      const messages = [msg("user", "u"), msg("assistant", ""), msg("user", "n")];
      expect(findFinalTextBetween(messages, 0, 2)).toBe("");
    });
    it("toolResult를 찾는다", () => {
      const messages = [msg("user", "u"), toolResult("out"), msg("user", "n")];
      expect(findFinalTextBetween(messages, 0, 2)).toBe("out");
    });
    it("assistant·toolResult가 아닌 메시지를 건너뛴다", () => {
      const messages = [
        msg("user", "u"),
        msg("user", "sys"),
        msg("assistant", "a"),
        msg("user", "n"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("a");
    });
    it("assistant가 전혀 없으면 빈 문자열을 반환한다", () => {
      const messages = [
        msg("user", "u"),
        msg("user", "sys"),
        msg("user", "other"),
        msg("user", "n"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("");
    });
  });

  describe("getHistoryPairsText 히스토리 쌍 텍스트 조회", () => {
    it("pairCount 0이면 빈 문자열을 반환한다", () =>
      expect(getHistoryPairsText({ messages: [msg("user", "hi")] }, 0)).toBe(""));
    it("pairCount가 음수면 빈 문자열을 반환한다", () =>
      expect(getHistoryPairsText({ messages: [msg("user", "hi")] }, -1)).toBe(""));
    it("히스토리가 없으면(user 1개) 빈 문자열을 반환한다", () =>
      expect(getHistoryPairsText({ messages: [msg("user", "hello")] }, 1)).toBe(""));
    it("user가 전혀 없으면 빈 문자열을 반환한다", () =>
      expect(getHistoryPairsText({ messages: [msg("assistant", "a")] }, 1)).toBe(""));
    it("user·assistant 쌍을 반환한다", () => {
      const ctx: Context = {
        messages: [msg("user", "u1"), msg("assistant", "a1"), msg("user", "current")],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("u1\na1");
    });
    it("finalText가 없으면 user만 반환한다", () => {
      const ctx: Context = {
        messages: [msg("user", "u1"), msg("user", "current")],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("u1");
    });
    it("빈 userText를 건너뛴다", () => {
      const ctx: Context = {
        messages: [msg("user", "   "), msg("assistant", "a1"), msg("user", "current")],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("");
    });
    it("빈 userText를 건너뛰고 다음 쌍을 유지한다", () => {
      const ctx: Context = {
        messages: [
          msg("user", "   "),
          msg("assistant", "a0"),
          msg("user", "u1"),
          msg("assistant", "a1"),
          msg("user", "current"),
        ],
      };
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\na1");
    });
    it("여러 쌍을 구분자로 결합한다", () => {
      const ctx: Context = {
        messages: [
          msg("user", "u1"),
          msg("assistant", "a1"),
          msg("user", "u2"),
          msg("assistant", "a2"),
          msg("user", "current"),
        ],
      };
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\na1\n---\nu2\na2");
    });
    it("toolResult를 final로 선택한다", () => {
      const ctx: Context = {
        messages: [msg("user", "u1"), toolResult("out"), msg("user", "current")],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("u1\nout");
    });
    it("pairCount가 히스토리보다 크면 전부를 반환한다", () => {
      const ctx: Context = {
        messages: [msg("user", "u1"), msg("assistant", "a1"), msg("user", "current")],
      };
      expect(getHistoryPairsText(ctx, 10)).toBe("u1\na1");
    });
    it("assistant 없이 user만 있으면 user들만 반환한다", () => {
      const ctx: Context = {
        messages: [msg("user", "u1"), msg("user", "u2"), msg("user", "current")],
      };
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\n---\nu2");
    });
  });
});
