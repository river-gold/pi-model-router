import type { AgentBeforeSettleEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseCanonicalModelRef } from "../config";
import { ROUTER_PROVIDER } from "../constants";
import type { RouterState } from "../state";

/** Recover only an error without partial output, and only while another candidate is usable. */
export const recoverFallback = async (
  event: AgentBeforeSettleEvent,
  ctx: ExtensionContext,
  state: RouterState,
) => {
  const decision = state.lastDecision;
  if (
    event.outcome !== "error" ||
    ctx.model?.provider !== ROUTER_PROVIDER ||
    !decision ||
    decision.router !== ctx.model.id
  )
    return;
  const last = event.context.contextEntries.findLast((entry) => entry.messages.length > 0);
  if (!last || last.sourceEntry.type !== "message") return;
  const message = last.messages.at(-1);
  if (
    !message ||
    message.role !== "assistant" ||
    message.stopReason !== "error" ||
    message.content.length > 0
  )
    return;
  if (message.provider !== decision.targetProvider || message.model !== decision.targetModelId)
    return;

  const failed = `${message.provider}/${message.model}`;
  const failures = new Set([...state.fallbackFailures, failed]);
  for (const ref of state.fallbackCandidates) {
    const { provider, modelId } = parseCanonicalModelRef(ref);
    if (provider === ROUTER_PROVIDER || failures.has(`${provider}/${modelId}`)) continue;
    const model = ctx.modelRegistry.find(provider, modelId);
    if (!model) continue;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) continue;
    state.fallbackFailures = failures;
    state.fallbackPending = true;
    return {
      entries: [
        ...event.entries,
        { type: "context_edit" as const, targetId: last.sourceEntry.id, replacement: null },
      ],
      continue: true,
    };
  }
};
