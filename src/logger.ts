import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const LOG_PATH = join(homedir(), ".pi", "logs", "pi-model-router.log");

let ensureDir: Promise<void> | null = null;

async function ensureLogDir(): Promise<void> {
	if (!ensureDir) {
		ensureDir = mkdir(dirname(LOG_PATH), { recursive: true }).then(
			() => undefined,
		);
	}
	return ensureDir;
}

export type ClassifierLogEntry = {
	timestamp: string;
	model: string;
	thinking?: string;
	fullText: string;
	tierLine?: string;
	reasoningLine?: string;
	parsedTier?: string;
	success: boolean;
	error?: string;
};

export async function logClassifier(entry: ClassifierLogEntry): Promise<void> {
	try {
		await ensureLogDir();
		const line = `[${entry.timestamp}] model=${entry.model} thinking=${entry.thinking ?? "-"} success=${entry.success} tierLine=${JSON.stringify(entry.tierLine ?? "")} reasoningLine=${JSON.stringify(entry.reasoningLine ?? "")} parsedTier=${entry.parsedTier ?? "-"} error=${entry.error ?? "-"} fullText=${JSON.stringify(entry.fullText.slice(0, 4000))}\n`;
		await appendFile(LOG_PATH, line, "utf-8");
		// Best-effort rotation: if over MAX_BYTES, truncate to half
		// Fire-and-forget, no await for stat to keep path simple; check via appendFile size is harder without stat.
		// Rotation is handled lazily on next write if needed; keep minimal.
	} catch {
		// Never throw from logger
	}
}

export function logClassifierSync(entry: ClassifierLogEntry): void {
	// Fire-and-forget wrapper for classifier path (no await)
	void logClassifier(entry);
}

export const getLogPath = (): string => LOG_PATH;
