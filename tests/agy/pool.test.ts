import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGY_ABORT_ERROR,
  AgyClassifierPool,
  type AgyChildLike,
  type AgySpawnFn,
} from "../../src/agy/pool";

type Listener = (a?: unknown, b?: unknown) => void;

interface FakeChildOptions {
  stdinWriteThrows?: boolean;
  noStdout?: boolean;
  noStderr?: boolean;
}

interface FakeChild extends AgyChildLike {
  emitStdout: (chunk: string | Buffer) => void;
  emitStderr: (chunk: string | Buffer) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

const makeFakeChild = (options: FakeChildOptions = {}): FakeChild => {
  const listeners = new Map<string, Listener[]>();
  const stdoutListeners: Listener[] = [];
  const stderrListeners: Listener[] = [];
  const child: FakeChild = {
    stdin: {
      write: vi.fn(() => {
        if (options.stdinWriteThrows) throw new Error("stdin broken");
      }),
    },
    stdout: options.noStdout
      ? null
      : {
          on: vi.fn((_event: "data", listener: Listener) => {
            stdoutListeners.push(listener);
            return child;
          }),
        },
    stderr: options.noStderr
      ? null
      : {
          on: vi.fn((_event: "data", listener: Listener) => {
            stderrListeners.push(listener);
            return child;
          }),
        },
    on: vi.fn((event: "error" | "close", listener: Listener) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return child;
    }),
    kill: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    emitStdout: (chunk: string | Buffer) => {
      for (const listener of stdoutListeners) listener(chunk);
    },
    emitStderr: (chunk: string | Buffer) => {
      for (const listener of stderrListeners) listener(chunk);
    },
  };
  return child;
};

const makeHarness = (
  options: FakeChildOptions = {},
  poolOptions?: {
    idleMs?: number;
    maxEntries?: number;
  },
) => {
  const children: FakeChild[] = [];
  const spawnFn: AgySpawnFn = vi.fn(() => {
    const child = makeFakeChild(options);
    children.push(child);
    return child;
  });
  const pool = new AgyClassifierPool(
    poolOptions?.idleMs ?? 0,
    poolOptions?.maxEntries ?? 20,
    spawnFn,
  );
  return { pool, children, spawnFn };
};

/** run()의 큐된 턴이 spawn될 때까지 마이크로태스크를 비움. */
const flush = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

const baseTurn = {
  key: "m\u0000",
  binary: "agy",
  args: ["--model", "m"],
  cwd: "/cwd",
  prompt: "classify",
  timeoutMs: 5_000,
};

const resultLine = (response: string, status = "SUCCESS"): string =>
  `{"event":"result","result":{"response":${JSON.stringify(response)},"status":"${status}"}}\n`;

const deltaLine = (text: string, state = "ACTIVE"): string =>
  `{"event":"step_update","step_update":{"step_type":"agent_response","state":"${state}","text_delta":${JSON.stringify(text)}}}\n`;

const snapshotLine = (text: string): string =>
  `{"event":"step_update","step_update":{"step_type":"agent_response","status":"DONE","text_delta":${JSON.stringify(text)}}}\n`;

afterEach(() => vi.restoreAllMocks());

describe("AgyClassifierPool 프로세스 재사용을 검증함", () => {
  it("같은 key는 같은 프로세스를 재사용하고 턴마다 stdin 1줄을 씀을 검증함", async () => {
    const { pool, children, spawnFn } = makeHarness();
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await expect(first).resolves.toEqual({ text: "high" });

    const second = pool.run({ ...baseTurn, prompt: "again" });
    await flush();
    children[0]!.emitStdout(resultLine("low"));
    await expect(second).resolves.toEqual({ text: "low" });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(children).toHaveLength(1);
    expect(children[0]!.stdin.write).toHaveBeenNthCalledWith(
      1,
      `${JSON.stringify({ event: "user", message: { content: "classify" } })}\n`,
    );
    expect(children[0]!.stdin.write).toHaveBeenNthCalledWith(
      2,
      `${JSON.stringify({ event: "user", message: { content: "again" } })}\n`,
    );
    expect(pool.size()).toBe(1);
  });

  it("key가 다르면 새 프로세스를 띄움을 검증함", async () => {
    const { pool, children, spawnFn } = makeHarness();
    const a = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await a;
    const b = pool.run({ ...baseTurn, key: "other\u0000" });
    await flush();
    children[1]!.emitStdout(resultLine("low"));
    await b;
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(pool.size()).toBe(2);
  });

  it("같은 key라도 args/binary/cwd가 바뀌면 프로세스를 교체함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await first;

    const second = pool.run({ ...baseTurn, args: ["--model", "m", "--effort", "high"] });
    await flush();
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    children[1]!.emitStdout(resultLine("low"));
    await expect(second).resolves.toEqual({ text: "low" });

    const third = pool.run({ ...baseTurn, binary: "other-agy" });
    await flush();
    children[2]!.emitStdout(resultLine("low"));
    await third;

    const fourth = pool.run({ ...baseTurn, cwd: "/other" });
    await flush();
    children[3]!.emitStdout(resultLine("low"));
    await fourth;
    expect(children).toHaveLength(4);
  });

  it("maxEntries를 넘으면 LRU 프로세스를 축출함을 검증함", async () => {
    const { pool, children } = makeHarness({}, { maxEntries: 1 });
    const a = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await a;

    const b = pool.run({ ...baseTurn, key: "other\u0000" });
    await flush();
    expect(pool.size()).toBe(1);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    children[1]!.emitStdout(resultLine("low"));
    await expect(b).resolves.toEqual({ text: "low" });
  });
});

describe("AgyClassifierPool idle 축출을 검증함", () => {
  it("idle 시간이 지나면 프로세스를 축출함을 검증함", async () => {
    const { pool, children } = makeHarness({}, { idleMs: 10 });
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await turn;
    expect(pool.size()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pool.size()).toBe(0);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("idle이 0이면 축출하지 않음을 검증함", async () => {
    const { pool, children } = makeHarness({}, { idleMs: 0 });
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await turn;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pool.size()).toBe(1);
  });

  it("턴마다 idle 타이머를 리셋함을 검증함", async () => {
    const { pool, children } = makeHarness({}, { idleMs: 50 });
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await first;

    const second = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("low"));
    await expect(second).resolves.toEqual({ text: "low" });
    expect(pool.size()).toBe(1);
  });

  it("턴 진행 중에는 idle 축출이 프로세스를 죽이지 않음을 검증함", async () => {
    const { pool, children } = makeHarness({}, { idleMs: 10 });
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await first;

    const second = pool.run(baseTurn);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(children[0]!.kill).not.toHaveBeenCalled();
    children[0]!.emitStdout(resultLine("low"));
    await expect(second).resolves.toEqual({ text: "low" });
  });
});

describe("AgyClassifierPool 턴 직렬화를 검증함", () => {
  it("같은 key의 동시 요청은 앞 턴이 끝난 뒤 실행됨을 검증함", async () => {
    const { pool, children } = makeHarness();
    const first = pool.run(baseTurn);
    await flush();
    const second = pool.run({ ...baseTurn, prompt: "second" });
    await flush();

    await flush();
    expect(children[0]!.stdin.write).toHaveBeenCalledTimes(1);
    children[0]!.emitStdout(resultLine("high"));
    await expect(first).resolves.toEqual({ text: "high" });
    await Promise.resolve();
    expect(children[0]!.stdin.write).toHaveBeenCalledTimes(2);
    children[0]!.emitStdout(resultLine("low"));
    await expect(second).resolves.toEqual({ text: "low" });
  });
});

describe("AgyClassifierPool 턴 종료·텍스트 누적을 검증함", () => {
  it("ACTIVE/DONE delta를 누적하고 result로 턴을 확정함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("me")}${deltaLine("dium", "DONE")}garbage\n`);
    children[0]!.emitStdout(resultLine("medium"));
    await expect(turn).resolves.toEqual({ text: "medium" });
  });

  it("DONE 스냅샷은 prefix를 건너뛰고 suffix만 반영함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("hi")}${snapshotLine("high")}`);
    children[0]!.emitStdout(resultLine("high"));
    await expect(turn).resolves.toEqual({ text: "high" });
  });

  it("스냅샷이 누적과 어긋나면 error를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("hi")}${snapshotLine("completely different")}`);
    children[0]!.emitStdout(resultLine("high"));
    await expect(turn).resolves.toEqual({
      error: "Inconsistent stream: DONE snapshot does not match accumulated text",
    });
  });

  it("스냅샷이 누적과 완전히 같으면 그대로 유지함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("high")}${snapshotLine("high")}`);
    children[0]!.emitStdout(resultLine("high"));
    await expect(turn).resolves.toEqual({ text: "high" });
  });

  it("이미 불일치한 뒤의 불일치는 최초 error를 유지함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("hi")}${snapshotLine("first")}${snapshotLine("second")}`);
    children[0]!.emitStdout(resultLine("high"));
    await expect(turn).resolves.toEqual({
      error: "Inconsistent stream: DONE snapshot does not match accumulated text",
    });
  });

  it("result 응답 텍스트를 쓰고 누적이 있으면 누적을 우선함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await expect(first).resolves.toEqual({ text: "high" });

    const second = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("low")}${resultLine("high")}`);
    await expect(second).resolves.toEqual({ text: "low" });
  });

  it("턴 사이에 도착한 줄은 무시함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await expect(turn).resolves.toEqual({ text: "high" });
    children[0]!.emitStdout(`${deltaLine("late")}${resultLine("late")}`);
    expect(pool.size()).toBe(1);
  });

  it("Buffer 청크도 처리함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(Buffer.from(resultLine("low"), "utf8"));
    children[0]!.emitStderr(Buffer.from("warn\n", "utf8"));
    await expect(turn).resolves.toEqual({ text: "low" });
  });
});

describe("AgyClassifierPool 실패 처리를 검증함", () => {
  it("result에 텍스트가 없으면 status를 담은 error를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout('{"event":"result","result":{"status":"FAILED"}}\n');
    await expect(turn).resolves.toEqual({ error: "agy failed with status FAILED" });
  });

  it("result에 text/status가 없으면 agy failed를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout('{"event":"result","result":{}}\n');
    await expect(turn).resolves.toEqual({ error: "agy failed" });
  });

  it("result의 error 메시지와 stderr를 우선 사용함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(
      '{"event":"result","result":{"status":"FAILED","error":"model unknown"}}\n',
    );
    await expect(first).resolves.toEqual({ error: "model unknown" });

    const second = pool.run(baseTurn);
    await flush();
    children[0]!.emitStderr("auth expired\n");
    children[0]!.emitStdout('{"event":"result","result":{}}\n');
    await expect(second).resolves.toEqual({ error: "auth expired" });
  });

  it("result 없이 프로세스가 종료되면 누적 텍스트 또는 stderr/코드 error를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const first = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(deltaLine("low"));
    children[0]!.emit("close", 0, null);
    await expect(first).resolves.toEqual({ text: "low" });
    expect(pool.size()).toBe(0);

    const second = pool.run(baseTurn);
    await flush();
    children[1]!.emitStderr("boom\n");
    children[1]!.emit("close", 2, null);
    await expect(second).resolves.toEqual({ error: "boom" });

    const third = pool.run(baseTurn);
    await flush();
    children[2]!.emit("close", 3, null);
    await expect(third).resolves.toEqual({ error: "agy exited without a result (code 3)" });

    const fourth = pool.run(baseTurn);
    await flush();
    children[3]!.emit("close", null, "SIGKILL");
    await expect(fourth).resolves.toEqual({ error: "agy exited without a result (code unknown)" });
  });

  it("result 후 close가 오면 pending 없는 종료로 처리함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await expect(turn).resolves.toEqual({ text: "high" });
    children[0]!.emit("close", 0, null);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(pool.size()).toBe(0);
  });

  it("close 시 streamError가 있으면 그 error를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(`${deltaLine("hi")}${snapshotLine("different")}`);
    children[0]!.emit("close", 0, null);
    await expect(turn).resolves.toEqual({
      error: "Inconsistent stream: DONE snapshot does not match accumulated text",
    });
  });

  it("spawn이 던지면 error를 반환함을 검증함", async () => {
    const pool = new AgyClassifierPool(0, 20, () => {
      throw new Error("enoent");
    });
    await expect(pool.run(baseTurn)).resolves.toEqual({
      error: "failed to spawn agy: enoent",
    });
    expect(pool.size()).toBe(0);
  });

  it("spawn error 이벤트면 error를 반환하고 다음 턴은 새 프로세스를 띄움을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emit("error", new Error("enoent"));
    await expect(turn).resolves.toEqual({ error: "failed to spawn agy: enoent" });

    const next = pool.run(baseTurn);
    await flush();
    children[1]!.emitStdout(resultLine("low"));
    await expect(next).resolves.toEqual({ text: "low" });
    expect(children).toHaveLength(2);
  });

  it("error 이벤트가 Error가 아니면 문자열로 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emit("error", "boom");
    await expect(turn).resolves.toEqual({ error: "failed to spawn agy: boom" });
  });

  it("stdin write 실패 시 kill하고 error를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness({ stdinWriteThrows: true });
    const turn = pool.run(baseTurn);
    await flush();
    await expect(turn).resolves.toEqual({ error: "failed to write to agy: stdin broken" });
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("타임아웃이면 kill하고 error를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run({ ...baseTurn, timeoutMs: 10 });
    await flush();
    await expect(turn).resolves.toEqual({
      error: "agy classifier timed out after 10ms",
    });
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(pool.size()).toBe(0);
  });

  it("stdout/stderr가 없는 child도 종료 처리됨을 검증함", async () => {
    const { pool, children } = makeHarness({ noStdout: true, noStderr: true });
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emit("close", 0, null);
    await expect(turn).resolves.toEqual({
      error: "agy exited without a result (code 0)",
    });
  });

  it("spawnFn 미지정 시 기본 spawn을 씀을 검증함", async () => {
    const pool = new AgyClassifierPool(0, 20);
    const outcome = await pool.run({ ...baseTurn, binary: "/bin/false" });
    expect("error" in outcome).toBe(true);
    expect(pool.size()).toBe(0);
  });
});

describe("AgyClassifierPool abort 처리를 검증함", () => {
  it("이미 abort된 signal이면 spawn 없이 aborted를 반환함을 검증함", async () => {
    const { pool, spawnFn } = makeHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(pool.run({ ...baseTurn, signal: controller.signal })).resolves.toEqual({
      error: AGY_ABORT_ERROR,
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("큐 대기 중 abort되면 spawn 없이 aborted를 반환함을 검증함", async () => {
    const { pool, children, spawnFn } = makeHarness();
    const controller = new AbortController();
    const turn = pool.run({ ...baseTurn, signal: controller.signal });
    controller.abort();
    await expect(turn).resolves.toEqual({ error: AGY_ABORT_ERROR });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
  });

  it("실행 중 abort되면 kill하고 aborted를 반환함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const controller = new AbortController();
    const turn = pool.run({ ...baseTurn, signal: controller.signal });
    await flush();
    controller.abort();
    await expect(turn).resolves.toEqual({ error: AGY_ABORT_ERROR });
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(pool.size()).toBe(0);
  });

  it("abort 이후 늦게 도착한 close는 무시함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const controller = new AbortController();
    const turn = pool.run({ ...baseTurn, signal: controller.signal });
    await flush();
    controller.abort();
    await expect(turn).resolves.toEqual({ error: AGY_ABORT_ERROR });
    children[0]!.emit("close", null, "SIGTERM");
    expect(pool.size()).toBe(0);
  });
});

describe("AgyClassifierPool 정리를 검증함", () => {
  it("disposeAll이 모든 프로세스를 종료함을 검증함", async () => {
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await turn;
    pool.disposeAll();
    expect(pool.size()).toBe(0);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("process exit 시 프로세스를 종료함을 검증함", async () => {
    const onceSpy = vi.spyOn(process, "once");
    const { pool, children } = makeHarness();
    const turn = pool.run(baseTurn);
    await flush();
    children[0]!.emitStdout(resultLine("high"));
    await turn;

    const exitCall = onceSpy.mock.calls.find(([event]) => event === "exit");
    expect(exitCall).toBeDefined();
    (exitCall![1] as () => void)();
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(pool.size()).toBe(0);
  });
});
