import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterProfile, RoutingDecision, RouterTier } from "../types";
import { resolveRoutingDecision } from "./routingDecision";

export { resolveRoutingDecision };

export const decideInitialDecision = (params: {
  profileName: string;
  profile: RouterProfile;
  context: Context;
  snapshotLastDecision: RoutingDecision | undefined;
  thinkingLevel: ThinkingLevel;
  isToolLoop: boolean;
  singleTier: RouterTier | undefined;
  validTierCount: number;
}): RoutingDecision => resolveRoutingDecision(params);
