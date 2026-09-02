import type { Context } from "@earendil-works/pi-ai";
import { extractTextFromContent } from "./extract";

export const findLastUserIndex = (messages: Context["messages"]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return i;
  }
  return -1;
};

export const getLastUserText = (context: Context): string => {
  const idx = findLastUserIndex(context.messages);
  if (idx === -1) return "";
  return extractTextFromContent(context.messages[idx]!.content).trim();
};
