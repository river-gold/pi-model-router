import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile } from "../types";

export const validateProviderState = (
  registry: ExtensionContext["modelRegistry"] | undefined,
  profile: RouterProfile | undefined,
  modelId: string,
): asserts profile is RouterProfile => {
  if (!registry)
    throw new Error("Router provider not initialized. session_start may not have fired.");
  if (!profile) throw new Error(`Unknown router profile: ${modelId}`);
};
