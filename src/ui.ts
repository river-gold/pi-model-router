import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RoutingDecision } from "./types";

export const formatDecision = (decision: RoutingDecision): string => {
  return `${decision.router}: ${decision.tier} -> ${decision.targetProvider}/${decision.targetModelId} [${decision.effort ?? "auto"}] (${decision.reasoning})`;
};

export const formatModelRef = (ref: string | undefined): string => {
  return ref ?? "none";
};

export const updateStatus = (
  ctx: ExtensionContext,
  routerEnabled: boolean,
  selectedRouter: string | undefined,
  lastDecision: RoutingDecision | undefined,
) => {
  const activeRouter = routerEnabled ? selectedRouter : undefined;

  if (activeRouter) {
    const matchesRouter = lastDecision && lastDecision.router === activeRouter;

    let statusText: string;
    if (lastDecision && matchesRouter) {
      statusText = `router:${activeRouter} -> ${lastDecision.tier} -> ${lastDecision.targetProvider}/${lastDecision.targetModelId} (${lastDecision.effort ?? "auto"})`;
    } else {
      statusText = `router:${activeRouter} -> waiting`;
    }
    ctx.ui.setStatus("router", `🚥 ${statusText}`);
  } else {
    ctx.ui.setStatus("router", undefined);
  }
};
