import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ConfigLoadResult, ParsedConfigFile, RouterConfig } from "../types";
import { isObjectRecord } from "./guards";
import { parseJsonc } from "./parse-jsonc";
import { mergeConfig } from "./merge";
import { normalizeConfig } from "./normalize";

export type FileSystem = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
};

export type AgentDirProvider = () => string;

export type PathJoin = (...parts: string[]) => string;

export type ParseConfigFileDeps = {
  fs: FileSystem;
  parseJsonc: (text: string) => unknown;
};

export const createParseConfigFile =
  (deps: ParseConfigFileDeps) =>
  (path: string): ParsedConfigFile => {
    if (!deps.fs.existsSync(path)) {
      return { config: {}, warnings: [] };
    }

    try {
      const raw = deps.fs.readFileSync(path, "utf-8");
      const parsed = deps.parseJsonc(raw);
      if (!isObjectRecord(parsed)) {
        return {
          config: {},
          warnings: [`Ignored router config at ${path}: expected a JSON object.`],
        };
      }
      return { config: parsed as Partial<RouterConfig>, warnings: [] };
    } catch (error) {
      return {
        config: {},
        warnings: [
          `Failed to parse router config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  };

const nodeFs: FileSystem = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
};

export const parseConfigFile = createParseConfigFile({
  fs: nodeFs,
  parseJsonc,
});

export type LoadRouterConfigDeps = {
  fs: FileSystem;
  getAgentDir: AgentDirProvider;
  join: PathJoin;
  parseConfigFile: (path: string) => ParsedConfigFile;
  mergeConfig: typeof mergeConfig;
  normalizeConfig: typeof normalizeConfig;
};

export const CONFIG_FILE_NAMES = {
  globalJson: "pi-model-router.json",
  globalJsonc: "pi-model-router.jsonc",
  projectJson: "pi-model-router.json",
  projectJsonc: "pi-model-router.jsonc",
} as const;

export const resolveConfigPaths = (
  cwd: string,
  getAgentDirFn: AgentDirProvider,
  joinFn: PathJoin,
): {
  globalJsonPath: string;
  globalJsoncPath: string;
  projectJsonPath: string;
  projectJsoncPath: string;
} => ({
  globalJsonPath: joinFn(getAgentDirFn(), CONFIG_FILE_NAMES.globalJson),
  globalJsoncPath: joinFn(getAgentDirFn(), CONFIG_FILE_NAMES.globalJsonc),
  projectJsonPath: joinFn(cwd, ".pi", CONFIG_FILE_NAMES.projectJson),
  projectJsoncPath: joinFn(cwd, ".pi", CONFIG_FILE_NAMES.projectJsonc),
});

export const createLoadRouterConfig =
  (deps: LoadRouterConfigDeps) =>
  (cwd: string): ConfigLoadResult => {
    const { globalJsonPath, globalJsoncPath, projectJsonPath, projectJsoncPath } =
      resolveConfigPaths(cwd, deps.getAgentDir, deps.join);

    const globalJsonResult = deps.parseConfigFile(globalJsonPath);
    const globalJsoncResult = deps.parseConfigFile(globalJsoncPath);
    const projectJsonResult = deps.parseConfigFile(projectJsonPath);
    const projectJsoncResult = deps.parseConfigFile(projectJsoncPath);

    const baseConfig: RouterConfig = { profiles: {} };
    let merged = deps.mergeConfig(baseConfig, globalJsonResult.config);
    merged = deps.mergeConfig(merged, globalJsoncResult.config);
    merged = deps.mergeConfig(merged, projectJsonResult.config);
    merged = deps.mergeConfig(merged, projectJsoncResult.config);
    const normalized = deps.normalizeConfig(merged);
    return {
      config: normalized.config,
      warnings: [
        ...globalJsonResult.warnings,
        ...globalJsoncResult.warnings,
        ...projectJsonResult.warnings,
        ...projectJsoncResult.warnings,
        ...normalized.warnings,
      ],
    };
  };

export const loadRouterConfig = createLoadRouterConfig({
  fs: nodeFs,
  getAgentDir,
  join,
  parseConfigFile,
  mergeConfig,
  normalizeConfig,
});
