import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isObjectRecord } from "../config/guards";

export type AnyModelRef = { provider: string; id: string };

const isAnyModelRef = (value: unknown): value is AnyModelRef =>
  isObjectRecord(value) && typeof value.provider === "string" && typeof value.id === "string";

const firstRef = (value: unknown): AnyModelRef | undefined => {
  if (!Array.isArray(value)) return undefined;
  const first: unknown = value[0];
  return isAnyModelRef(first) ? first : undefined;
};

const readField = (registry: ExtensionContext["modelRegistry"], field: string): unknown => {
  if (!isObjectRecord(registry)) return undefined;
  return registry[field];
};

const tryGetFromList = (registry: ExtensionContext["modelRegistry"]): AnyModelRef | undefined => {
  try {
    const list: unknown = readField(registry, "list");
    if (typeof list !== "function") return undefined;
    return firstRef(list());
  } catch {
    // ignore
  }
  return undefined;
};

const tryGetFromModels = (registry: ExtensionContext["modelRegistry"]): AnyModelRef | undefined => {
  try {
    return firstRef(readField(registry, "models"));
  } catch {
    // ignore
  }
  return undefined;
};

export const getAnyModel = (registry: ExtensionContext["modelRegistry"]): AnyModelRef | undefined =>
  tryGetFromList(registry) ?? tryGetFromModels(registry);
