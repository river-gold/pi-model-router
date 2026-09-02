import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { LOG_PATH } from "./constants";

export type Mkdir = (path: string, opts: { recursive: boolean }) => Promise<unknown>;
export type Dirname = (p: string) => string;

export const createEnsureLogDir = (
  mkdirFn: Mkdir = mkdir as unknown as Mkdir,
  dirnameFn: Dirname = dirname,
  logPath: string = LOG_PATH,
) => {
  let ensureDir: Promise<void> | null = null;
  const fn = async (): Promise<void> => {
    if (!ensureDir) {
      ensureDir = (mkdirFn(dirnameFn(logPath), { recursive: true }) as Promise<unknown>).then(
        () => undefined,
      );
    }
    return ensureDir;
  };
  // expose for testing reset
  (fn as unknown as { _reset: () => void })._reset = () => {
    ensureDir = null;
  };
  return fn;
};

export const ensureLogDir = createEnsureLogDir();
