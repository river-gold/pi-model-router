/**
 * 분류기 전용 agy 풀 — (model, effort)별 long-lived 프로세스 1개를 재사용함.
 *
 * 브리지(pi-agent-bridge)의 spawn/턴 계약을 따름:
 *   agy --add-dir <cwd> --model <id> [--effort <e>] [--json-schema <s>]
 *       --input-format stream-json --output-format stream-json
 *   Stdin:  턴마다 NDJSON 1줄 `{event:"user",message:{content:prompt}}`
 *   Stdout: NDJSON(init/step_update/result). result 이벤트가 턴 종료 지점임.
 *
 * 세션 바인딩(--conversation)을 쓰지 않고 턴마다 전체 프롬프트를 보냄.
 * stream-json 프로토콜에는 conversation 리셋 이벤트가 없어 턴 간 대화가 프로세스에
 * 누적되므로, idle 축출(기본 30분)로 주기적으로 폐기해 누적을 비움.
 */
import { spawn } from "node:child_process";
import { parseAgyStreamLine } from "./parse";

export const AGY_ABORT_ERROR = "aborted";

export interface AgyChildLike {
  stdin: {
    write: (chunk: string, cb?: (err?: Error | null) => void) => unknown;
  };
  stdout: {
    on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  } | null;
  stderr: {
    on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  } | null;
  on: (event: "error" | "close", listener: (a?: unknown, b?: unknown) => void) => unknown;
  kill: (signal?: NodeJS.Signals) => boolean;
}

export type AgySpawnFn = (
  binary: string,
  args: string[],
  options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] },
) => AgyChildLike;

export interface AgyTurnParams {
  key: string;
  binary: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type AgyTurnOutcome = { text: string } | { error: string };

interface PendingTurn {
  accumulated: string;
  streamError?: Error;
  settled: boolean;
  settle: (outcome: AgyTurnOutcome) => void;
}

interface PoolEntry {
  key: string;
  binary: string;
  args: string[];
  cwd: string;
  child?: AgyChildLike;
  pending?: PendingTurn;
  queue: Promise<unknown>;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastUsed: number;
  closed: boolean;
}

const MAX_STDERR_CHARS = 500;

const asError = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

const killChild = (child: AgyChildLike | undefined): void => {
  try {
    child?.kill("SIGTERM");
  } catch {
    // already gone
  }
};

const toChunkString = (chunk: Buffer | string): string =>
  typeof chunk === "string" ? chunk : chunk.toString("utf8");

export class AgyClassifierPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly spawnFn: AgySpawnFn;

  constructor(
    private readonly idleMs: number,
    private readonly maxEntries: number,
    spawnFn?: AgySpawnFn,
  ) {
    this.spawnFn = spawnFn ?? (spawn as AgySpawnFn);
    process.once("exit", () => this.disposeAll());
  }

  /** 턴 1개를 실행함. 같은 key는 프로세스를 재사용하고, 턴은 프로세스별로 직렬화됨. */
  run(params: AgyTurnParams): Promise<AgyTurnOutcome> {
    if (params.signal?.aborted) return Promise.resolve({ error: AGY_ABORT_ERROR });
    const entry = this.ensureEntry(params);
    const turn = entry.queue.then(() => this.runTurn(params));
    entry.queue = turn;
    return turn;
  }

  /** 모든 프로세스를 종료하고 풀을 비움. */
  disposeAll(): void {
    for (const entry of Array.from(this.entries.values())) this.disposeEntry(entry);
  }

  size(): number {
    return this.entries.size;
  }

  private ensureEntry(params: AgyTurnParams): PoolEntry {
    const existing = this.entries.get(params.key);
    if (existing && !existing.closed) {
      if (this.matches(existing, params)) return existing;
      this.disposeEntry(existing);
    }
    const entry: PoolEntry = {
      key: params.key,
      binary: params.binary,
      args: params.args,
      cwd: params.cwd,
      queue: Promise.resolve(),
      lastUsed: Date.now(),
      closed: false,
    };
    this.entries.set(params.key, entry);
    this.enforceMaxEntries();
    return entry;
  }

  private matches(entry: PoolEntry, params: AgyTurnParams): boolean {
    return (
      entry.binary === params.binary &&
      entry.cwd === params.cwd &&
      entry.args.join("\u0000") === params.args.join("\u0000")
    );
  }

  private runTurn(params: AgyTurnParams): Promise<AgyTurnOutcome> {
    return new Promise<AgyTurnOutcome>((resolve) => {
      if (params.signal?.aborted) {
        resolve({ error: AGY_ABORT_ERROR });
        return;
      }
      const entry = this.ensureEntry(params);
      // 턴 진행 중에는 idle 축출이 프로세스를 죽이지 않게 타이머를 멈춤.
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
      const pending: PendingTurn = {
        accumulated: "",
        settled: false,
        settle: (outcome) => {
          if (pending.settled) return;
          pending.settled = true;
          clearTimeout(timer);
          params.signal?.removeEventListener("abort", onAbort);
          resolve(outcome);
        },
      };
      const timer = setTimeout(() => {
        killChild(entry.child);
        this.disposeEntry(entry);
        pending.settle({ error: `agy classifier timed out after ${params.timeoutMs}ms` });
      }, params.timeoutMs);
      const onAbort = (): void => {
        killChild(entry.child);
        this.disposeEntry(entry);
        pending.settle({ error: AGY_ABORT_ERROR });
      };
      if (params.signal) params.signal.addEventListener("abort", onAbort, { once: true });

      if (!entry.child || entry.closed) {
        let child: AgyChildLike;
        try {
          child = this.spawnFn(entry.binary, entry.args, {
            cwd: entry.cwd,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (e) {
          this.disposeEntry(entry);
          pending.settle({ error: `failed to spawn agy: ${asError(e)}` });
          return;
        }
        entry.child = child;
        entry.closed = false;
        this.wireChild(entry, child);
      }

      entry.pending = pending;
      entry.lastUsed = Date.now();

      try {
        entry.child.stdin.write(
          `${JSON.stringify({ event: "user", message: { content: params.prompt } })}\n`,
        );
      } catch (e) {
        killChild(entry.child);
        this.disposeEntry(entry);
        pending.settle({ error: `failed to write to agy: ${asError(e)}` });
      }
    });
  }

  private wireChild(entry: PoolEntry, child: AgyChildLike): void {
    let buffer = "";
    let stderr = "";

    const completeTurn = (outcome: AgyTurnOutcome): void => {
      const pending = entry.pending;
      entry.pending = undefined;
      entry.lastUsed = Date.now();
      this.resetIdleTimer(entry);
      pending?.settle(outcome);
    };

    const handleLine = (rawLine: string): void => {
      const parsed = parseAgyStreamLine(rawLine);
      const pending = entry.pending;
      if (!parsed || !pending) return;

      if (parsed.kind === "text") {
        if (!parsed.snapshot) {
          pending.accumulated += parsed.text;
          return;
        }
        // DONE 스냅샷은 전체 텍스트임: 이미 누적한 prefix는 건너뛰고 suffix만 반영.
        if (parsed.text.startsWith(pending.accumulated)) {
          const suffix = parsed.text.slice(pending.accumulated.length);
          if (suffix) pending.accumulated = parsed.text;
        } else if (!pending.streamError) {
          pending.streamError = new Error(
            "Inconsistent stream: DONE snapshot does not match accumulated text",
          );
        }
        return;
      }

      const finalText = pending.accumulated || parsed.response;
      if (pending.streamError) completeTurn({ error: pending.streamError.message });
      else if (finalText) completeTurn({ text: finalText });
      else {
        completeTurn({
          error: parsed.error?.trim() || stderr.trim() || this.describeStatus(parsed.status),
        });
      }
    };

    child.stdout?.on("data", (chunk) => {
      buffer += toChunkString(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) handleLine(line);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${toChunkString(chunk)}`.slice(0, MAX_STDERR_CHARS);
    });
    child.on("error", (err) => {
      const pending = entry.pending;
      this.disposeEntry(entry);
      pending?.settle({ error: `failed to spawn agy: ${asError(err)}` });
    });
    child.on("close", (code) => {
      const pending = entry.pending;
      this.disposeEntry(entry);
      if (!pending) return;
      if (pending.streamError) pending.settle({ error: pending.streamError.message });
      else if (pending.accumulated) pending.settle({ text: pending.accumulated });
      else {
        pending.settle({
          error: stderr.trim() || `agy exited without a result (code ${code ?? "unknown"})`,
        });
      }
    });
  }

  private describeStatus(status: string | undefined): string {
    return status ? `agy failed with status ${status}` : "agy failed";
  }

  private resetIdleTimer(entry: PoolEntry): void {
    // 턴 시작에서 idle 타이머를 지우므로 여기서는 항상 없는 상태임.
    if (this.idleMs <= 0) return;
    const timer = setTimeout(() => this.disposeEntry(entry), this.idleMs);
    timer.unref();
    entry.idleTimer = timer;
  }

  private enforceMaxEntries(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.values()].toSorted((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of sorted.slice(0, this.entries.size - this.maxEntries)) {
      this.disposeEntry(entry);
    }
  }

  private disposeEntry(entry: PoolEntry): void {
    entry.closed = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
    this.entries.delete(entry.key);
    killChild(entry.child);
    entry.child = undefined;
  }
}
