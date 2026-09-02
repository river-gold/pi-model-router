import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RouterTier } from "../types";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../constants";
import { parseCanonicalModelRef } from "./modelRef";

export const resolveContextWindow = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_CONTEXT_WINDOW;

  if (tierConfig.contextWindow !== undefined && tierConfig.contextWindow > 0) {
    return tierConfig.contextWindow;
  }

  if (modelRegistry) {
    try {
      const ref = tierConfig.models?.[0] ?? "";
      const { provider, modelId } = parseCanonicalModelRef(ref);
      const registryModel = modelRegistry.find(provider, modelId);
      if (registryModel?.contextWindow) return registryModel.contextWindow;
    } catch {
      // ignore invalid ref or registry miss
    }
  }

  return tierConfig.resolvedContextWindow ?? DEFAULT_CONTEXT_WINDOW;
};

export const resolveMaxTokens = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_MAX_TOKENS;

  if (tierConfig.maxTokens !== undefined && tierConfig.maxTokens > 0) {
    return tierConfig.maxTokens;
  }

  if (modelRegistry) {
    try {
      const ref = tierConfig.models?.[0] ?? "";
      const { provider, modelId } = parseCanonicalModelRef(ref);
      const registryModel = modelRegistry.find(provider, modelId);
      if (registryModel?.maxTokens) return registryModel.maxTokens;
    } catch {
      // ignore
    }
  }

  return tierConfig.resolvedMaxTokens ?? DEFAULT_MAX_TOKENS;
};
