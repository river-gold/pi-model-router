import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Router, RoutingDecision, RouterTier } from "../types";
import { resolveRoutingDecision } from "./routingDecision";

export { resolveRoutingDecision };

export const decideInitialDecision = (params: {
  routerName: string;
  router: Router;
  context: Context;
  snapshotLastDecision: RoutingDecision | undefined;
  thinkingLevel: ThinkingLevel;
  isToolLoop: boolean;
  singleTier: RouterTier | undefined;
  validTierCount: number;
  routers?: Record<string, Router>;
}): RoutingDecision => resolveRoutingDecision(params);
