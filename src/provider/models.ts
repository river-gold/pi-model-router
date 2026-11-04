import type { RouterConfig, Router, RouterTier } from "../types";
import {
  routerNames,
  ROUTER_TIERS,
  resolveContextWindowLive,
  resolveMaxTokensLive,
  dereferenceTier,
  parseCanonicalModelRef,
} from "../config";
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
  const routerList = routerNames(config);
  return routerList.map((name) => {
    const router = config.routers[name] as Router;
    let minContextWindow = Infinity;
    let maxMaxTokens = DEFAULT_MAX_TOKENS;
    for (const tier of ROUTER_TIERS.filter((t) => router[t])) {
      const cw = resolveContextWindowLive(config.routers, name, tier as RouterTier, registry);
      const mot = resolveMaxTokensLive(config.routers, name, tier as RouterTier, registry);
      minContextWindow = Math.min(minContextWindow, cw);
      for (const ref of dereferenceTier(config.routers, name, tier)?.config.models ?? []) {
        const { provider, modelId } = parseCanonicalModelRef(ref);
        const window = registry?.find(provider, modelId)?.contextWindow;
        if (window && window > 0) minContextWindow = Math.min(minContextWindow, window);
      }
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
      contextWindow: Number.isFinite(minContextWindow) ? minContextWindow : DEFAULT_CONTEXT_WINDOW,
      maxTokens: maxMaxTokens,
    };
  });
};

export const buildModelsKey = (definitions: ReturnType<typeof buildModelDefinitions>): string =>
  definitions.map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`).join(",");
