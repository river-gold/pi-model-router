import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RouterTier } from "../types";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../constants";
import { parseCanonicalModelRef } from "./modelRef";
import { dereferenceTier } from "./ref";

const limitFromConfig = (
  tierConfig: { models?: string[]; contextWindow?: number; maxTokens?: number },
  kind: "contextWindow" | "maxTokens",
  registry: ExtensionContext["modelRegistry"] | undefined,
): number | undefined => {
  if (
    kind === "contextWindow" &&
    tierConfig.contextWindow !== undefined &&
    tierConfig.contextWindow > 0
  ) {
    return tierConfig.contextWindow;
  }
  if (kind === "maxTokens" && tierConfig.maxTokens !== undefined && tierConfig.maxTokens > 0) {
    return tierConfig.maxTokens;
  }
  if (registry) {
    try {
      const ref = tierConfig.models?.[0] ?? "";
      const { provider, modelId } = parseCanonicalModelRef(ref);
      const registryModel = registry.find(provider, modelId);
      if (kind === "contextWindow" && registryModel?.contextWindow)
        return registryModel.contextWindow;
      if (kind === "maxTokens" && registryModel?.maxTokens) return registryModel.maxTokens;
    } catch {
      // ignore invalid ref or registry miss
    }
  }
  return undefined;
};

export const resolveContextWindow = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_CONTEXT_WINDOW;

  return (
    limitFromConfig(tierConfig, "contextWindow", modelRegistry) ??
    tierConfig.resolvedContextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
};

export const resolveMaxTokens = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_MAX_TOKENS;

  return (
    limitFromConfig(tierConfig, "maxTokens", modelRegistry) ??
    tierConfig.resolvedMaxTokens ??
    DEFAULT_MAX_TOKENS
  );
};

/** ref를 실시간 추적해서 context window를 구함. */
export const resolveContextWindowLive = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
  modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
  const resolved = dereferenceTier(profiles, profileName, tier);
  if (!resolved) return DEFAULT_CONTEXT_WINDOW;
  return (
    limitFromConfig(resolved.config, "contextWindow", modelRegistry) ??
    resolved.config.resolvedContextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
};

/** ref를 실시간 추적해서 max tokens를 구함. */
export const resolveMaxTokensLive = (
  profiles: Record<string, RouterProfile>,
  profileName: string,
  tier: RouterTier,
  modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
  const resolved = dereferenceTier(profiles, profileName, tier);
  if (!resolved) return DEFAULT_MAX_TOKENS;
  return (
    limitFromConfig(resolved.config, "maxTokens", modelRegistry) ??
    resolved.config.resolvedMaxTokens ??
    DEFAULT_MAX_TOKENS
  );
};
