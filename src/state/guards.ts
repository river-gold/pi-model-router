import type { RouterPersistedState } from "../types";
import { isObjectRecord } from "../config/guards";

export const isRouterPersistedState = (value: unknown): value is RouterPersistedState => {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    typeof value.selectedRouter === "string" &&
    typeof value.timestamp === "number"
  );
};
