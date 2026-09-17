import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RouterTier, RoutingDecision } from "../types";
import { resolveAvailableTier, buildRoutingDecision, buildRoutingDecisionLive } from "../routing";
import { resolveAvailableTierLive, isDirectEffortRef } from "../config";
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
  sessionId?: string,
  profiles?: Record<string, RouterProfile>,
): Promise<RoutingDecision> => {
  if (isSingleTier || isToolLoopNow || thinkingLevel !== "off") return decision;
  // 기본 tier 자리에 `##effort` 강제 지정이 있으면 분류기를 돌릴 의미가 없으므로 건너뜀.
  if (profiles && isDirectEffortRef(profiles, decision.profile, decision.tier)) return decision;
  const effectiveHistorySize = state.currentConfig.historySize ?? 0;
  const failedSet = state.failedByChain.get(CLASSIFIER_CHAIN_KEY) ?? new Set<string>();
  let result: { tier: RouterTier; reasoning: string } | undefined;
  try {
    ({ result } = await runClassifierBranch(
      registry,
      profile,
      state,
      context,
      signal,
      effectiveHistorySize,
      failedSet,
      classifierSource,
      sessionId,
      modelId,
      profiles,
    ));
  } catch (e) {
    if (e instanceof Error && e.message === "aborted") throw e;
    return decision;
  }
  if (!result) return decision;
  const requestedTier = result.tier;
  const resolvedTier = profiles
    ? (resolveAvailableTierLive(profiles, modelId, requestedTier)?.tier ?? requestedTier)
    : resolveAvailableTier(profile, requestedTier);
  let reasoning = `Classifier: ${result.reasoning}`;
  if (resolvedTier !== requestedTier) {
    reasoning = `Resolved from ${requestedTier} to ${resolvedTier} tier (${requestedTier} tier is not configured). Original: ${reasoning}`;
  }
  return profiles
    ? buildRoutingDecisionLive(profiles, modelId, resolvedTier, reasoning, true)
    : buildRoutingDecision(modelId, profile, resolvedTier, reasoning, true);
};
