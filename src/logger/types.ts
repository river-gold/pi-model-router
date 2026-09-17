export type ClassifierLogEntry = {
  timestamp: string;
  model: string;
  effort?: string;
  fullText: string;
  tierLine?: string;
  reasoningLine?: string;
  parsedTier?: string;
  success: boolean;
  error?: string;
};
