import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Router } from "../types";

export const validateProviderState = (
  registry: ExtensionContext["modelRegistry"] | undefined,
  router: Router | undefined,
  modelId: string,
): asserts router is Router => {
  if (!registry)
    throw new Error("Router provider not initialized. session_start may not have fired.");
  if (!router) throw new Error(`Unknown router router: ${modelId}`);
};
