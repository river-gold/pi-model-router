import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RoutingDecision } from "../types";
import { resolveAvailableTier, buildRoutingDecision } from "../routing";
import { CLASSIFIER_CHAIN_KEY } from "../failureMemory";
import { runClassifierBranch } from "./classifierBranch";
import type { RouterProviderState } from "./state";

export const applyClassifierIfNeeded = async (
  profile: RouterProfile,
  decision: RoutingDecision,
  modelId: string,
  registry: ExtensionContext["modelRegistry"],
  state: RouterProviderState,
  context: Context,
  signal: AbortSignal | undefined,
  isSingleTier: boolean,
  isToolLoopNow: boolean,
  thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>,
  classifierSource: string,
): Promise<RoutingDecision> => {
  if (isSingleTier || isToolLoopNow || thinkingLevel !== "off") return decision;
  const effectiveHistorySize = state.currentConfig.historySize ?? 0;
  const failedSet = state.failedByChain.get(CLASSIFIER_CHAIN_KEY) ?? new Set<string>();
  const { result } = await runClassifierBranch(
    registry,
    profile,
    state,
    context,
    signal,
    effectiveHistorySize,
    failedSet,
    classifierSource,
  );
  const tier = resolveAvailableTier(profile, result!.tier);
  let reasoning = `Classifier: ${result!.reasoning}`;
  if (tier !== result!.tier) {
    reasoning = `Resolved from ${result!.tier} to ${tier} tier (${result!.tier} tier is not configured). Original: ${reasoning}`;
  }
  return buildRoutingDecision(modelId, profile, tier, reasoning, true);
};
