/* oxlint-disable */
// Backward-compatible barrel: re-export everything from modular config
export * from "./config/index";
export type { ClassifierSource, ClassifierEntry } from "./config/classifier";
export type {
  FileSystem,
  AgentDirProvider,
  PathJoin,
  ParseConfigFileDeps,
  LoadRouterConfigDeps,
} from "./config/io";
