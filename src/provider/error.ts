import type { Api, AssistantMessage, Model, AssistantMessageEventStream } from "@earendil-works/pi-ai";

export const createErrorMessage = (model: Model<Api>, message: string): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "error",
  errorMessage: message,
  timestamp: Date.now(),
});

export const normalizeDelegateError = (lastError: unknown): Error => {
  if (lastError instanceof Error) return lastError;
  if (typeof lastError === "string") return new Error(lastError);
  return new Error("Failed to delegate to any model in the chain.");
};

export const pushStreamError = (
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  error: unknown,
): void => {
  if (error instanceof Error && error.message === "aborted") {
    stream.push({ type: "done", reason: "stop", message: createErrorMessage(model, "aborted") });
    stream.end();
    return;
  }
  if (error instanceof Error && error.message.includes("stale")) {
    stream.push({ type: "done", reason: "stop", message: createErrorMessage(model, "") });
  } else {
    const msg = error instanceof Error ? error.message : String(error);
    stream.push({ type: "error", reason: "error", error: createErrorMessage(model, msg) });
  }
  stream.end();
};
