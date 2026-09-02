import type { RouterConfig, RouterProfile } from "../types";
import { profileNames, ROUTER_TIERS, resolveContextWindow, resolveMaxTokens } from "../config";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "../constants";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const buildModelDefinitions = (
  config: RouterConfig,
  registry: ExtensionContext["modelRegistry"] | undefined,
): Array<{
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap: Record<string, string>;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}> => {
  const profileList = profileNames(config);
  return profileList.map((name) => {
    const profile = config.profiles[name] as RouterProfile;
    let maxContextWindow = DEFAULT_CONTEXT_WINDOW;
    let maxMaxTokens = DEFAULT_MAX_TOKENS;
    for (const tier of ROUTER_TIERS.filter((t) => profile[t])) {
      const cw = resolveContextWindow(tier as import("../types").RouterTier, profile, registry);
      const mot = resolveMaxTokens(tier as import("../types").RouterTier, profile, registry);
      if (cw > maxContextWindow) maxContextWindow = cw;
      if (mot > maxMaxTokens) maxMaxTokens = mot;
    }
    return {
      id: name,
      name: `Router ${name}`,
      reasoning: true,
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: maxContextWindow,
      maxTokens: maxMaxTokens,
    };
  });
};

export const buildModelsKey = (
  definitions: ReturnType<typeof buildModelDefinitions>,
): string => definitions.map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`).join(",");
