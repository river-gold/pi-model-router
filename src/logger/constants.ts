import { homedir } from "node:os";
import { join } from "node:path";

export const getLogPath = (home = homedir()): string =>
  join(home, ".pi", "logs", "pi-model-router.log");

export const LOG_PATH = getLogPath();
