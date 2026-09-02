import type { Api, Model } from "@earendil-works/pi-ai";

export const resolveDelegatedReasoning = (
  model: Model<Api>,
  requested: string | undefined,
): string | undefined => {
  if (!requested || !model.reasoning) return undefined;
  if (requested === "off") return undefined;
  return requested;
};
