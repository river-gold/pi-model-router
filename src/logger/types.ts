export type ClassifierLogEntry = {
  timestamp: string;
  model: string;
  thinking?: string;
  fullText: string;
  tierLine?: string;
  reasoningLine?: string;
  parsedTier?: string;
  success: boolean;
  error?: string;
};
