import type { Message } from "@earendil-works/pi-ai";

export const extractPartText = (part: Exclude<Message["content"], string>[number]): string => {
  if (part.type === "text") return part.text;
  if (part.type === "thinking") return part.thinking;
  if (part.type === "toolCall") return `${part.name} ${JSON.stringify(part.arguments)}`;
  return "";
};

export const extractTextFromContent = (content: string | Message["content"]): string => {
  if (typeof content === "string") return content;
  return content.map(extractPartText).filter(Boolean).join("\n");
};
