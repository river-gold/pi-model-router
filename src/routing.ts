import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterTier } from "./types";

/** pi thinking level을 라우터 tier로 매핑한다. */
export const thinkingToTier = (thinking: ThinkingLevel): RouterTier => {
  if (thinking === "off") return "off";
  if (thinking === "max") return "max";
  if (thinking === "xhigh") return "xhigh";
  if (thinking === "high") return "high";
  if (thinking === "medium") return "medium";
  if (thinking === "low") return "low";
  return "minimal";
};
