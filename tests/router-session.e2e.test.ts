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
const failedModels = new Set<string>();
afterEach(() => {
  vi.restoreAllMocks();
  failedModels.clear();
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "router-virtual-e2e-"));
  mkdirSync(join(root, ".pi"));
  writeFileSync(
    join(root, ".pi", "pi-model-router.json"),
    JSON.stringify({
      routers: {
        ordered: {
          low: { models: ["fixture/c"] },
          medium: { models: ["fixture/b#high"] },
          high: { models: ["fixture/a"] },
        },
        random: {
          random: true,
          medium: { models: ["fixture/a", "fixture/b", "fixture/c"] },
        },
        single: { high: { models: ["fixture/a"] } },
        delegated: { medium: { models: ["@ordered#high"] } },
        nokey: { medium: { models: ["nokey/x", "fixture/c"] } },
        fallback: { medium: { models: ["fixture/a", "fixture/b"] } },
      },
    }),
  );
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const { model } = JSON.parse(Buffer.concat(chunks).toString()) as { model: string };
      received.push(model);
      if (failedModels.has(model)) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rate limit exceeded" } }));
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

const startSession = async (manager: SessionManager, routerName = "ordered", retry = false) => {
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
      contextWindow: 100000,
      maxTokens: 1024,
    })),
  });
  modelRuntime.registerProvider("nokey", {
    api: "openai-completions",
    baseUrl: endpoint,
    models: [
      {
        id: "x",
        name: "x",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 1024,
      },
    ],
  });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: retry ? { enabled: true, maxRetries: 2, baseDelayMs: 1 } : { enabled: false },
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
  if (!model) throw new Error(`router model ${routerName} missing`);
  await session.setModel(model);
  session.setThinkingLevel("medium");
  return session;
};

describe("가상 모델 라우팅", () => {
  it("thinking level을 tier로 매핑해 물리 모델을 고른다", async () => {
    const session = await startSession(SessionManager.inMemory(root));
    await session.prompt("medium");
    expect(received.at(-1)).toBe("b");
    session.setThinkingLevel("high");
    await session.prompt("high");
    expect(received.at(-1)).toBe("a");
    session.setThinkingLevel("low");
    await session.prompt("low");
    expect(received.at(-1)).toBe("c");
    session.dispose();
  });

  it("설정되지 않은 tier는 가까운 tier로 폴백한다", async () => {
    const session = await startSession(SessionManager.inMemory(root));
    session.setThinkingLevel("off");
    await session.prompt("off");
    expect(received.at(-1)).toBe("c");
    session.dispose();
  });

  it("단일 tier 라우터는 thinking level과 무관하게 그 tier를 쓴다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "single");
    session.setThinkingLevel("off");
    await session.prompt("single");
    expect(received.at(-1)).toBe("a");
    session.dispose();
  });

  it("@router 위임을 실시간으로 해석한다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "delegated");
    await session.prompt("delegated");
    expect(received.at(-1)).toBe("a");
    session.dispose();
  });

  it("자격 증명 없는 후보는 건너뛴다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "nokey");
    await session.prompt("nokey");
    expect(received.at(-1)).toBe("c");
    session.dispose();
  });

  it("retryable 실패 시 다음 후보로 폴백한다", async () => {
    const session = await startSession(SessionManager.inMemory(root), "fallback", true);
    failedModels.add("a");
    await session.prompt("fallback");
    expect(received).toContain("a");
    expect(received.at(-1)).toBe("b");
    session.dispose();
  });
});

describe("가상 모델의 무작위 선택", () => {
  it("세션 내에서 선택을 유지하고 세션 재개 후에도 복원한다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = SessionManager.create(root, join(root, "random-sessions"));
    const first = await startSession(manager, "random");
    await first.prompt("첫 요청");
    expect(received.at(-1)).toBe("a");
    await first.prompt("두 번째 요청");
    expect(received.at(-1)).toBe("a");
    const path = first.sessionFile;
    first.dispose();
    if (!path) throw new Error("session file missing");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const resumed = await startSession(SessionManager.open(path), "random");
    await resumed.prompt("재개 후 요청");
    expect(received.at(-1)).toBe("a");
    resumed.dispose();
  });

  it("세션 포크 시 부모의 선택을 상속한다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const parent = await startSession(
      SessionManager.create(root, join(root, "fork-parent")),
      "random",
    );
    await parent.prompt("부모 요청");
    expect(received.at(-1)).toBe("a");
    const path = parent.sessionFile;
    parent.dispose();
    if (!path) throw new Error("session file missing");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const child = await startSession(
      SessionManager.forkFrom(path, root, join(root, "fork-child")),
      "random",
    );
    await child.prompt("자식 요청");
    expect(received.at(-1)).toBe("a");
    child.dispose();
  });
});
