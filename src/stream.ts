import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type StreamProvider = {
  streamSimple: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
};

type StreamableRegistry = {
  getProvider?: (provider: string) => StreamProvider | undefined;
};

export const modelWithAuthBaseUrl = <T extends { baseUrl: string }>(
  model: T,
  auth: { baseUrl?: string },
): T => {
  if (auth.baseUrl && auth.baseUrl !== model.baseUrl) {
    return { ...model, baseUrl: auth.baseUrl };
  }
  return model;
};

export const streamDelegated = (
  registry: ExtensionContext["modelRegistry"],
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const provider = (registry as StreamableRegistry).getProvider?.(model.provider);
  if (!provider?.streamSimple) {
    throw new Error(`No delegated stream provider registered for ${model.provider}`);
  }
  // pi의 provider는 정규화된 transcript(context.messages)만 읽는다. 레거시 Context의
  // systemPrompt/tools를 system 메시지로 접어 넘기지 않으면 위임 요청에서 조용히 사라진다.
  return provider.streamSimple(model, normalizeContext(context), options);
};
