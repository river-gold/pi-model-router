import type { ClassifierLogEntry } from "./types";

export const buildLogLine = (entry: ClassifierLogEntry): string => {
  const thinking = entry.thinking ?? "-";
  const tierLine = entry.tierLine ?? "";
  const reasoningLine = entry.reasoningLine ?? "";
  const parsedTier = entry.parsedTier ?? "-";
  const error = entry.error ?? "-";
  const fullText = entry.fullText.slice(0, 4000);
  return `[${entry.timestamp}] model=${entry.model} thinking=${thinking} success=${entry.success} tierLine=${JSON.stringify(tierLine)} reasoningLine=${JSON.stringify(reasoningLine)} parsedTier=${parsedTier} error=${error} fullText=${JSON.stringify(fullText)}\n`;
};
