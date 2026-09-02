import type { RouterPersistedState } from "../types";

export const isRouterPersistedState = (value: unknown): value is RouterPersistedState => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.selectedProfile === "string" &&
    typeof v.timestamp === "number"
  );
};
