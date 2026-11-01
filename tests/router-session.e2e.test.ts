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
const efforts: (string | undefined)[] = [];
const failedModels = new Set<string>();
afterEach(() => {
  vi.restoreAllMocks();
  failedModels.clear();
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
      },
    }),
  );
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const { model, reasoning_effort } = JSON.parse(Buffer.concat(chunks).toString()) as {
        model: string;
        reasoning_effort?: string;
      };
      received.push(model);
      efforts.push(reasoning_effort);
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

const startSession = async (manager: SessionManager) => {
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
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
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
  const model = modelRuntime.getModel("router", "test");
  if (!model) throw new Error("router model missing");
  await session.setModel(model);
  session.setThinkingLevel("medium");
  return session;
};

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
