import { appendFile } from "node:fs/promises";
import { LOG_PATH } from "./constants";
import { buildLogLine } from "./build";
import { ensureLogDir } from "./ensure";
import type { ClassifierLogEntry } from "./types";

export type AppendFile = (path: string, data: string, encoding: string) => Promise<void>;
export type EnsureLogDirFn = () => Promise<void>;
export type BuildLogLine = (entry: ClassifierLogEntry) => string;

export const createLogClassifierSync = (
  appendFileFn: AppendFile = appendFile as unknown as AppendFile,
  ensureLogDirFn: EnsureLogDirFn = ensureLogDir,
  buildLogLineFn: BuildLogLine = buildLogLine,
  logPath: string = LOG_PATH,
) => {
  const fn = (entry: ClassifierLogEntry): void => {
    void (async () => {
      try {
        await ensureLogDirFn();
        const line = buildLogLineFn(entry);
        await appendFileFn(logPath, line, "utf-8");
      } catch {
        // Never throw from logger
      }
    })();
  };
  return fn;
};

export const logClassifierSync = createLogClassifierSync();
