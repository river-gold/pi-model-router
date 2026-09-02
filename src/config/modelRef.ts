import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { ALLOWED_THINKING } from "./constants";

const isAllowedThinking = (value: string): value is ThinkingLevel =>
  (ALLOWED_THINKING as readonly string[]).includes(value);

export const parseCanonicalModelRef = (
  value: string,
): { provider: string; modelId: string; thinking?: ThinkingLevel } => {
  const hashIndex = value.indexOf("#");
  const rawRef = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const thinkingRaw = hashIndex === -1 ? undefined : value.slice(hashIndex + 1).trim();
  const slashIndex = rawRef.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid model reference "${value}". Expected "provider/model[#thinking]".`);
  }
  const provider = rawRef.slice(0, slashIndex).trim();
  const modelId = rawRef.slice(slashIndex + 1).trim();
  if (!provider || !modelId) {
    throw new Error(`Invalid model reference "${value}". Expected "provider/model[#thinking]".`);
  }
  if (thinkingRaw !== undefined) {
    if (thinkingRaw && !isAllowedThinking(thinkingRaw)) {
      throw new Error(
        `Invalid thinking "${thinkingRaw}": expected one of ${ALLOWED_THINKING.join(", ")}.`,
      );
    }
  }
  return {
    provider,
    modelId,
    ...(thinkingRaw ? { thinking: thinkingRaw as ThinkingLevel } : {}),
  };
};

export const formatModelRef = (
  provider: string,
  modelId: string,
  thinking?: ThinkingLevel,
): string => (thinking ? `${provider}/${modelId}#${thinking}` : `${provider}/${modelId}`);
