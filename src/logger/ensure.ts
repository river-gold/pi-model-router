import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { LOG_PATH } from "./constants";

export type Mkdir = (path: string, opts: { recursive: boolean }) => Promise<unknown>;
export type Dirname = (p: string) => string;

export type ResettableEnsure = (() => Promise<void>) & { _reset?: () => void };

export const createEnsureLogDir = (
  mkdirFn: Mkdir = (path, opts) => mkdir(path, opts),
  dirnameFn: Dirname = dirname,
  logPath: string = LOG_PATH,
) => {
  let ensureDir: Promise<void> | null = null;
  const fn: ResettableEnsure = async (): Promise<void> => {
    if (!ensureDir) {
      ensureDir = mkdirFn(dirnameFn(logPath), { recursive: true }).then(() => undefined);
    }
    return ensureDir;
  };
  // expose for testing reset
  fn._reset = () => {
    ensureDir = null;
  };
  return fn;
};

export const ensureLogDir = createEnsureLogDir();
