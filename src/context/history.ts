import type { Context } from "@earendil-works/pi-ai";
import { extractTextFromContent } from "./extract";

export const collectUserIndices = (messages: Context["messages"]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") out.push(i);
  }
  return out;
};

export const resolveHistoryUserIndices = (
  userIndices: number[],
  pairCount: number,
): number[] => {
  if (userIndices.length === 0) return [];
  const lastIdx = userIndices[userIndices.length - 1]!;
  // exclude last (current) user
  const beforeLast = userIndices.slice(0, -1);
  // take last pairCount from before-last
  if (pairCount >= beforeLast.length) return beforeLast;
  return beforeLast.slice(-pairCount);
};

export const buildUserPosMap = (userIndices: number[]): Map<number, number> => {
  const m = new Map<number, number>();
  for (let p = 0; p < userIndices.length; p++) {
    m.set(userIndices[p]!, p);
  }
  return m;
};

export const isAssistantOrToolResult = (role: string): boolean =>
  role === "assistant" || role === "toolResult";

export const getNextUserIdx = (
  userIndices: number[],
  pos: number,
  messagesLength: number,
): number => (pos + 1 < userIndices.length ? userIndices[pos + 1]! : messagesLength);

export const findFinalTextBetween = (
  messages: Context["messages"],
  fromIdx: number,
  toIdx: number,
): string => {
  for (let j = toIdx - 1; j > fromIdx; j--) {
    const msg = messages[j]!;
    if (!isAssistantOrToolResult(msg.role)) continue;
    const txt = extractTextFromContent(msg.content).trim();
    if (txt) return txt;
  }
  return "";
};

export const getHistoryPairsText = (context: Context, pairCount: number): string => {
  if (!pairCount || pairCount <= 0) return "";
  const messages = context.messages;
  const userIndices = collectUserIndices(messages);
  const historyUserIndices = resolveHistoryUserIndices(userIndices, pairCount);
  if (historyUserIndices.length === 0) return "";
  const userPosByIndex = buildUserPosMap(userIndices);

  const pairs: string[] = [];
  for (const uIdx of historyUserIndices) {
    const userText = extractTextFromContent(messages[uIdx]!.content).trim();
    if (!userText) continue;
    const pos = userPosByIndex.get(uIdx)!;
    const nextUserIdx = getNextUserIdx(userIndices, pos, messages.length);
    const finalText = findFinalTextBetween(messages, uIdx, nextUserIdx);
    if (finalText) {
      pairs.push(`${userText}\n${finalText}`);
    } else {
      pairs.push(userText);
    }
  }
  return pairs.join("\n---\n");
};
