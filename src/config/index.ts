export { ROUTER_TIERS, ALLOWED_THINKING } from "./constants";
export { isObjectRecord, isRouterTier } from "./guards";
export { parseJsonc } from "./parse-jsonc";
export { parseCanonicalModelRef, formatModelRef, parseDelegatedRef } from "./modelRef";
export type { ParsedDelegatedRef } from "./modelRef";
export {
  mergeTier,
  normalizeModelList,
  normalizeTierConfig,
  resolveAvailableTier,
  nearbyTierOrder,
} from "./tier";
export { dereferenceTier, resolveAvailableTierLive, resolvableTiers } from "./ref";
export type { ResolvedTier } from "./ref";
export { mergeConfig } from "./merge";
export { normalizeConfig } from "./normalize";
export {
  parseConfigFile,
  createParseConfigFile,
  loadRouterConfig,
  createLoadRouterConfig,
  resolveConfigPaths,
  CONFIG_FILE_NAMES,
} from "./io";
export type {
  FileSystem,
  AgentDirProvider,
  PathJoin,
  ParseConfigFileDeps,
  LoadRouterConfigDeps,
} from "./io";
export { routerNames, resolveRouterName } from "./router";
export {
  resolveContextWindow,
  resolveMaxTokens,
  resolveContextWindowLive,
  resolveMaxTokensLive,
} from "./registry";
