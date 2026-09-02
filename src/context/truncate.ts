import type { Context } from "@earendil-works/pi-ai";
import { estimateTokens } from "./tokens";
import { extractTextFromContent } from "./extract";

export const calculateSystemTokens = (systemPrompt: string | undefined): number =>
  systemPrompt ? estimateTokens(systemPrompt) : 0;

export const calculateMessageTokens = (messages: Context["messages"]): number[] =>
  messages.map((m) => estimateTokens(extractTextFromContent(m.content)));

export const findStartIndex = (
  messages: Context["messages"],
  messageTokens: number[],
  systemTokens: number,
  latestTokens: number,
  limit: number,
): number => {
  let activeSum = messageTokens.reduce((sum, t) => sum + t, 0);
  for (let start = 0; start < messages.length; start++) {
    const current = systemTokens + latestTokens + activeSum;
    if (current <= limit) return start;
    activeSum -= messageTokens[start]!;
  }
  return messages.length;
};

export const alignToUserBoundary = (messages: Context["messages"], startIndex: number): number => {
  if (startIndex >= messages.length) return startIndex;
  for (let a = startIndex; a < messages.length; a++) {
    if (messages[a]!.role === "user") return a;
  }
  return startIndex;
};

export const countLeadingOrphanToolResults = (messages: Context["messages"]): number => {
  let count = 0;
  for (let k = 0; k < messages.length; k++) {
    if (messages[k]!.role === "toolResult" && k === count) {
      count++;
    } else {
      break;
    }
  }
  return count;
};

export const truncateContext = (context: Context, limit: number): Context => {
  const messages = [...context.messages];
  if (messages.length <= 1) return context;

  const systemTokens = calculateSystemTokens(context.systemPrompt);
  const messageTokens = calculateMessageTokens(messages);
  const totalTokens = systemTokens + messageTokens.reduce((sum, t) => sum + t, 0);
  if (totalTokens <= limit) return context;

  const latestMessage = messages.pop()!;
  const latestTokens = messageTokens.pop()!;
  const startIndexRaw = findStartIndex(messages, messageTokens, systemTokens, latestTokens, limit);
  const startIndex = alignToUserBoundary(messages, startIndexRaw);
  let finalMessages = [...messages.slice(startIndex), latestMessage];
  const orphanCount = countLeadingOrphanToolResults(finalMessages);
  if (orphanCount > 0) {
    finalMessages = finalMessages.slice(orphanCount);
  }
  return { ...context, messages: finalMessages };
};
