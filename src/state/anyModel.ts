import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type AnyModelRef = { provider: string; id: string };

const tryGetFromList = (
  registry: ExtensionContext["modelRegistry"],
): AnyModelRef | undefined => {
  try {
    const withList = registry as unknown as { list?: () => AnyModelRef[] };
    const listed = withList.list?.()?.[0];
    if (listed) return listed;
  } catch {
    // ignore
  }
  return undefined;
};

const tryGetFromModels = (
  registry: ExtensionContext["modelRegistry"],
): AnyModelRef | undefined => {
  try {
    const withModels = registry as unknown as { models?: AnyModelRef[] };
    const m = withModels.models?.[0];
    if (m) return m;
  } catch {
    // ignore
  }
  return undefined;
};

export const getAnyModel = (
  registry: ExtensionContext["modelRegistry"],
): AnyModelRef | undefined => tryGetFromList(registry) ?? tryGetFromModels(registry);
