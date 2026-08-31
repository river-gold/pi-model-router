import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

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
  registry: ExtensionContext['modelRegistry'],
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const provider = (registry as StreamableRegistry).getProvider?.(model.provider);
  if (!provider?.streamSimple) {
    throw new Error(`No stream provider registered for ${model.provider}`);
  }
  return provider.streamSimple(model, context, options);
};
