import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import routerExtension from "../src/index";

let server: Server;
let root: string;
let endpoint: string;
const received: string[] = [];
const receivedBodies: { model: string; messages: unknown[] }[] = [];
const efforts: (string | undefined)[] = [];
const failedModels = new Set<string>();
const billingFailedModels = new Set<string>();
afterEach(() => {
  vi.restoreAllMocks();
  failedModels.clear();
  billingFailedModels.clear();
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "router-session-e2e-"));
  mkdirSync(join(root, ".pi"));
  writeFileSync(
    join(root, ".pi", "pi-model-router.json"),
    JSON.stringify({
      routers: {
        test: {
          random: true,
          medium: { models: ["fixture/a#high", "fixture/b", "fixture/c"] },
          high: { models: ["fixture/a", "fixture/b", "fixture/c"] },
        },
        delegated: { models: ["@target"], medium: {}, high: {} },
        target: {
          medium: { models: ["fixture/b#low"] },
          high: { models: ["fixture/a#high"] },
        },
        conservative: { medium: { models: ["fixture/a", "fixture/c"] } },
        cycle: { medium: { models: ["@cycle"] } },
      },
    }),
  );
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const { model, reasoning_effort, messages } = JSON.parse(
        Buffer.concat(chunks).toString(),
      ) as {
        model: string;
        reasoning_effort?: string;
        messages: unknown[];
      };
      received.push(model);
      receivedBodies.push({ model, messages });
      efforts.push(reasoning_effort);
      if (billingFailedModels.has(model)) {
        res.writeHead(402, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "You're out of credits", type: "billing_error" } }),
        );
        return;
      }
      if (failedModels.has(model)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "Auth failed", type: "invalid_request_error" } }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  endpoint = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(root, { recursive: true, force: true });
});

const startSession = async (manager: SessionManager, routerName = "test", autoCompact = false) => {
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
  });
  modelRuntime.registerProvider("fixture", {
    api: "openai-completions",
    baseUrl: endpoint,
    apiKey: "test",
    models: ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: id === "c" ? 40000 : 100000,
      maxTokens: 1024,
    })),
  });
  const settingsManager = SettingsManager.inMemory({
    compaction: {
      enabled: autoCompact,
      keepRecentTokens: 1,
      ...(autoCompact ? { reserveTokens: 39999 } : {}),
    },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [routerExtension],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    modelRuntime,
    resourceLoader: loader,
    settingsManager,
    sessionManager: manager,
    noTools: "all",
  });
  await session.bindExtensions({
    mode: "print",
    onError: (error) => {
      throw error.error;
    },
  });
  const model = modelRuntime.getModel("router", routerName);
  if (!model) throw new Error("router model missing");
  await session.setModel(model);
  session.setThinkingLevel("medium");
  return session;
};

describe("라우터 컨텍스트 한도", () => {
  it("순환 위임으로 해석 가능한 후보가 없으면 오류를 반환한다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "cycle");
    try {
      await session.prompt("순환 참조");
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
    } finally {
      session.dispose();
    }
  });

  it("폴백 모델에 전달할 때 대화 내역을 조용히 삭제하지 않는다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "conservative");
    const text = `보존할 원문:${"x".repeat(180000)}`;
    try {
      await session.prompt(text);
      billingFailedModels.add("a");
      const start = receivedBodies.length;
      await session.prompt("후속 질문");
      const fallback = receivedBodies.slice(start).find((body) => body.model === "c");
      expect(fallback).toBeDefined();
      expect(JSON.stringify(fallback?.messages)).toContain(text);
    } finally {
      session.dispose();
    }
  });

  it("Pi에 폴백 후보까지 포함한 최소 컨텍스트 한도를 제공한다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "conservative");
    try {
      expect(session.model?.contextWindow).toBe(40000);
    } finally {
      session.dispose();
    }
  });
});

describe("위임 라우팅", () => {
  it("tier 없는 위임은 선택된 바깥 tier를 따라간다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "delegated");
    try {
      session.setThinkingLevel("max");
      await session.prompt("높은 티어");
      expect(received.at(-1)).toBe("a");
      expect(efforts.at(-1)).toBe("high");
      session.setThinkingLevel("medium");
      await session.prompt("중간 티어");
      expect(received.at(-1)).toBe("b");
      expect(efforts.at(-1)).toBe("low");
    } finally {
      session.dispose();
    }
  });
});

describe("컴팩션과 자식 세션의 라우팅", () => {
  it("자동 컴팩션 중 첫 모델이 402를 반환하면 폴백하고 요청을 이어간다", async () => {
    const manager = SessionManager.inMemory(root);
    const session = await startSession(manager, "conservative", true);
    try {
      await session.prompt("이전 대화 ".repeat(10000));
      billingFailedModels.add("a");
      const start = received.length;
      await session.prompt("자동 컴팩션 후 요청");
      expect(received.slice(start)).toContain("a");
      expect(received.slice(start)).toContain("c");
      expect(manager.getBranch().some((entry) => entry.type === "compaction")).toBe(true);
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
    } finally {
      session.dispose();
    }
  });

  it("컴팩션 요약 중 402가 발생하면 다른 모델로 요약하고 대화를 이어간다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = SessionManager.inMemory(root);
    const session = await startSession(manager);
    try {
      await session.prompt("이전 대화 ".repeat(10000));
      await session.prompt("후속 대화");
      billingFailedModels.add("a");
      const start = received.length;
      await session.compact();
      expect(received.slice(start)).toEqual(["a", "b", "b"]);
      expect(manager.getBranch().some((entry) => entry.type === "compaction")).toBe(true);
      await session.prompt("컴팩션 후 요청");
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
    } finally {
      session.dispose();
    }
  });

  it("라우터를 독립 로드한 자식 세션은 402 발생 시 다른 모델을 사용한다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const parent = await startSession(SessionManager.inMemory(root));
    const child = await startSession(SessionManager.inMemory(root));
    try {
      await parent.prompt("부모 요청");
      billingFailedModels.add("a");
      const start = received.length;
      await child.prompt("자식 요청");
      expect(received.slice(start)).toEqual(["a", "b"]);
      expect(child.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
    } finally {
      parent.dispose();
      child.dispose();
    }
  });
});

describe("Pi 세션의 무작위 라우팅", () => {
  it("각 티어의 선택을 독립적으로 유지한다", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const session = await startSession(SessionManager.inMemory(root));
    await session.prompt("중간 티어");
    expect(received.at(-1)).toBe("a");
    random.mockReturnValue(0.99);
    session.setThinkingLevel("high");
    await session.prompt("높은 티어");
    expect(received.at(-1)).toBe("c");
    session.setThinkingLevel("medium");
    await session.prompt("중간 티어 재사용");
    expect(received.at(-1)).toBe("a");
    session.setThinkingLevel("high");
    await session.prompt("높은 티어 재사용");
    expect(received.at(-1)).toBe("c");
    session.dispose();
  });

  it("무작위 폴백은 이전 모델의 effort를 물려받지 않는다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const session = await startSession(SessionManager.inMemory(root));
    failedModels.add("a");
    await session.prompt("폴백 요청");
    expect(received.slice(-2)).toEqual(["a", "b"]);
    expect(efforts.slice(-2)).toEqual(["high", undefined]);
    session.dispose();
  });

  it("모델 실패 시 다른 모델을 무작위로 선택하고 이후 유지한다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const session = await startSession(SessionManager.inMemory(root));
    failedModels.add("c");
    await session.prompt("첫 요청");
    expect(received.slice(-2)).toEqual(["c", "b"]);
    await session.prompt("다음 요청");
    expect(received.at(-1)).toBe("b");
    session.dispose();
  });

  it("모든 후보가 인증 실패한 뒤에는 다시 호출하지 않는다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const session = await startSession(SessionManager.inMemory(root));
    ["a", "b", "c"].forEach((model) => failedModels.add(model));
    await session.prompt("실패 요청");
    expect(received.slice(-3)).toEqual(["c", "b", "a"]);
    const count = received.length;
    await session.prompt("재시도 요청");
    expect(received).toHaveLength(count);
    session.dispose();
  });

  it("저장된 선택이 잘못된 타입이면 무시하고 다시 선택한다", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = SessionManager.create(root, join(root, "invalid-sessions"));
    const first = await startSession(manager);
    await first.prompt("첫 요청");
    const entry = manager
      .getBranch()
      .findLast((e) => e.type === "custom" && e.customType === "router-state");
    if (!entry || entry.type !== "custom") throw new Error("router state missing");
    manager.appendCustomEntry("router-state", {
      ...entry.data,
      randomSelections: { '["test","medium"]': 12 },
    });
    const path = first.sessionFile;
    first.dispose();
    if (!path) throw new Error("session file missing");
    random.mockReturnValue(0.99);
    const resumed = await startSession(SessionManager.open(path));
    await resumed.prompt("재개 요청");
    expect(received.at(-1)).toBe("c");
    resumed.dispose();
  });

  it("부모 세션의 기록을 복사한 자식은 다른 모델을 선택한다", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const parent = await startSession(SessionManager.create(root, join(root, "parent-sessions")));
    await parent.prompt("부모 요청");
    expect(received.at(-1)).toBe("a");
    const path = parent.sessionFile;
    parent.dispose();
    if (!path) throw new Error("session file missing");
    random.mockReturnValue(0.99);
    const child = await startSession(
      SessionManager.forkFrom(path, root, join(root, "child-sessions")),
    );
    await child.prompt("자식 요청");
    expect(received.at(-1)).toBe("c");
    await child.prompt("자식 후속 요청");
    expect(received.at(-1)).toBe("c");
    child.dispose();
  });
  it("세션 재개 후 같은 모델을 유지한다", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = SessionManager.create(root, join(root, "sessions"));
    const first = await startSession(manager);
    await first.prompt("첫 요청");
    await first.prompt("두 번째 요청");
    random.mockReturnValue(0.99);
    await first.bindExtensions({ mode: "print" });
    await first.prompt("다시 바인딩 후 요청");
    const selected = received.at(-1);
    expect(received.at(-2)).toBe(selected);
    const path = first.sessionFile;
    first.dispose();
    if (!path) throw new Error("session file missing");
    const resumed = await startSession(SessionManager.open(path));
    await resumed.prompt("재개 후 요청");
    expect(received.at(-1)).toBe(selected);
    resumed.dispose();
  });
});
