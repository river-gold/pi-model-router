import type { RoutingDecision } from "./types";

export const formatDecision = (decision: RoutingDecision): string =>
  `${decision.router}: ${decision.tier} -> ${decision.targetProvider}/${decision.targetModelId} [${decision.effort ?? "auto"}] (${decision.reasoning})`;
