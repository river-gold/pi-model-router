import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { ALLOWED_THINKING } from "./constants";

const isStreamThinking = (value: string): value is ThinkingLevel =>
  value !== "off" && (ALLOWED_THINKING as readonly string[]).includes(value);

export const resolveDelegatedReasoning = (
  model: Model<Api>,
  requested: string | undefined,
): ThinkingLevel | undefined => {
  if (!requested || !model.reasoning) return undefined;
  if (requested === "off") return undefined;
  if (!isStreamThinking(requested)) return undefined;
  return requested;
};
