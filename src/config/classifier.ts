import type { ClassifierConfig, RouterProfile } from "../types";
import { formatModelRef, parseCanonicalModelRef } from "./modelRef";

export const normalizeClassifierConfig = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierConfig | undefined => {
  if (typeof raw !== "string") return undefined;
  if (raw.trim() === "") return undefined;
  try {
    const { provider, modelId, thinking } = parseCanonicalModelRef(raw.trim());
    return { model: formatModelRef(provider, modelId), thinking };
  } catch (error) {
    warnings.push(
      `Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
};

export const normalizeClassifierModels = (
  raw: unknown,
  warnings: string[],
  contextLabel: string,
): ClassifierConfig[] | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") {
    const single = normalizeClassifierConfig(raw, warnings, contextLabel);
    return single ? [single] : undefined;
  }
  if (Array.isArray(raw)) {
    const out: ClassifierConfig[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = normalizeClassifierConfig(raw[i], warnings, `${contextLabel}[${i}]`);
      if (c) out.push(c);
    }
    return out.length > 0 ? out : undefined;
  }
  warnings.push(`Invalid ${contextLabel}: expected string or array of strings.`);
  return undefined;
};

export type ClassifierSource = "profile" | "global" | "low tier";

export type ClassifierEntry = ClassifierConfig & { source: ClassifierSource };

export const resolveEffectiveClassifier = (
  profile: RouterProfile,
  globalClassifiers: ClassifierConfig[] | undefined,
): { classifiers: ClassifierEntry[] | undefined; source: string } => {
  const chain: ClassifierEntry[] = [];
  const sources: string[] = [];

  if (profile.classifierModels && profile.classifierModels.length > 0) {
    chain.push(
      ...profile.classifierModels.map((c) => ({
        ...c,
        source: "profile" as const,
      })),
    );
    sources.push("profile");
  }
  if (globalClassifiers && globalClassifiers.length > 0) {
    chain.push(...globalClassifiers.map((c) => ({ ...c, source: "global" as const })));
    sources.push("global");
  }
  const lowModels = profile.low?.models;
  if (lowModels && lowModels.length > 0) {
    chain.push(
      ...lowModels.map((m) => {
        const { provider, modelId, thinking } = parseCanonicalModelRef(m);
        return {
          model: formatModelRef(provider, modelId),
          thinking,
          source: "low tier" as const,
        };
      }),
    );
    sources.push("low tier");
  }

  return {
    classifiers: chain.length > 0 ? chain : undefined,
    source: sources.length > 0 ? sources.join(" → ") : "none",
  };
};
