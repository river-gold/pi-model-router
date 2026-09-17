import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Router, RouterTier, RoutingDecision } from "../types";
import { resolveAvailableTier, buildRoutingDecision, buildRoutingDecisionLive } from "../routing";
import { resolveAvailableTierLive } from "../config";
import { CLASSIFIER_CHAIN_KEY } from "../failureMemory";
import { runClassifierBranch } from "./classifierBranch";
import type { RouterProviderState } from "./state";

export const applyClassifierIfNeeded = async (
  router: Router,
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
  routers?: Record<string, Router>,
): Promise<RoutingDecision> => {
  if (isSingleTier || isToolLoopNow || thinkingLevel !== "off") return decision;
  const effectiveHistorySize = state.currentConfig.historySize ?? 0;
  const failedSet = state.failedByChain.get(CLASSIFIER_CHAIN_KEY) ?? new Set<string>();
  let result: { tier: RouterTier; reasoning: string } | undefined;
  try {
    ({ result } = await runClassifierBranch(
      registry,
      router,
      state,
      context,
      signal,
      effectiveHistorySize,
      failedSet,
      classifierSource,
      sessionId,
      modelId,
      routers,
    ));
  } catch (e) {
    if (e instanceof Error && e.message === "aborted") throw e;
    return decision;
  }
  if (!result) return decision;
  const requestedTier = result.tier;
  const resolvedTier = routers
    ? (resolveAvailableTierLive(routers, modelId, requestedTier)?.tier ?? requestedTier)
    : resolveAvailableTier(router, requestedTier);
  let reasoning = `Classifier: ${result.reasoning}`;
  if (resolvedTier !== requestedTier) {
    reasoning = `Resolved from ${requestedTier} to ${resolvedTier} tier (${requestedTier} tier is not configured). Original: ${reasoning}`;
  }
  return routers
    ? buildRoutingDecisionLive(routers, modelId, resolvedTier, reasoning, true)
    : buildRoutingDecision(modelId, router, resolvedTier, reasoning, true);
};
