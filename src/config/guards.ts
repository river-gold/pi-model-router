import type { RouterTier, TypesafeClassifierConfig } from "../types";
import { ROUTER_TIERS } from "./constants";

export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isRouterTier = (value: unknown): value is RouterTier =>
  typeof value === "string" && (ROUTER_TIERS as readonly string[]).includes(value);

export const isTypesafeClassifierConfig = (value: unknown): value is TypesafeClassifierConfig =>
  isObjectRecord(value) && value.typesafe === true && typeof value.model === "string";
