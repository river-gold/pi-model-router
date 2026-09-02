/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { registerRouterProvider } from "../src/provider";
import type { Api, Model, Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig } from "../src/types";

vi.mock("@earendil-works/pi-ai", () => ({ createAssistantMessageEventStream: vi.fn() }));
const streamSimple = vi.fn();
class S { events: unknown[] = []; push(e: unknown) { this.events.push(e); } end() {} }
const makeReg = (find?: (p: string, id: string) => unknown) => ({
  find: vi.fn((p: string, id: string) => find ? find(p, id) : ({ provider: p, id, input: ["text"], contextWindow: 5000, reasoning: true } as unknown)),
  getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
  getProvider: () => ({ streamSimple }),
} as unknown as ExtensionContext["modelRegistry"]);
const ctx = (msgs: unknown[]) => ({ messages: msgs } as unknown as Context);
const mdl = (id: string, cw = 100000) => ({ id, provider: "router", api: "a" as Api, contextWindow: cw } as unknown as Model<Api>);
const wait = (ms = 90) => new Promise((r) => setTimeout(r, ms));

describe("provider", () => {
  let pi: ExtensionAPI; let state: Parameters<typeof registerRouterProvider>[1]; let acts: Parameters<typeof registerRouterProvider>[2]; let opts: { streamSimple: (m: Model<Api>, c: Context, o?: unknown) => unknown };
  beforeEach(() => {
    vi.clearAllMocks(); streamSimple.mockReset();
    pi = { registerProvider: vi.fn((_, o) => { opts = o as unknown as typeof opts; }), getThinkingLevel: vi.fn().mockReturnValue("medium") } as unknown as ExtensionAPI;
    const cfg: RouterConfig = { profiles: { balanced: { high: { models: ["openai/gpt-4o"] } as unknown, medium: { models: ["openai/gpt-4o-mini", "google/gemini-1.5-flash"] } as unknown } } };
    state = { lastRegisteredModels: "", currentConfig: cfg, currentModelRegistry: makeReg(), lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() } } as unknown as ExtensionContext, selectedProfile: undefined, routerEnabled: false, lastDecision: undefined, accumulatedCost: 0, failedByChain: new Map() };
    acts = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
  });
  it("thinking high mapping", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("high");
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "ok" }; yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(state.lastDecision?.tier).toBe("high");
  });
  it("minimal fallback to low", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("minimal");
    state.currentConfig.profiles.balanced.low = { models: ["openai/gpt-4o-micro"] } as unknown; state.currentConfig.profiles.balanced.minimal = undefined;
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "ok" }; yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(state.lastDecision?.tier).toBe("low"); expect(state.lastDecision?.reasoning).toContain("resolved to low");
  });
  it("single tier skip", async () => {
    state.currentConfig = { profiles: { single: { high: { models: ["openai/gpt"] } as unknown } } } as RouterConfig;
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "hi" }; yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown);
    opts.streamSimple(mdl("single"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(state.lastDecision?.tier).toBe("high");
  });
  it("tool loop preserve", async () => {
    const prev = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt", targetLabel: "openai/gpt", reasoning: "prev", timestamp: Date.now() } as unknown as never;
    state.lastDecision = prev as unknown as never; (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "a" }; yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }, { role: "toolResult", toolCallId: "1", toolName: "t", content: "out", isError: false, timestamp: 2 } as unknown])); await wait(); expect(state.lastDecision?.tier).toBe("high"); expect(state.lastDecision?.reasoning).toContain("Preserved");
  });
  it("classifier off no classifier error", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(s.events.some((e) => (e as { type: string }).type === "error" && (e as { error: { errorMessage: string } }).error.errorMessage.includes("No classifier"))).toBe(true);
  });
  it("classifier global fallback success", async () => {
    state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt-high"] } as unknown, medium: { models: ["openai/mini"] } as unknown } }, classifierModels: [{ model: "openai/gpt" } as unknown], historySize: 0 } as RouterConfig;
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off"); registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockReturnValueOnce((async function* () { yield { type: "text_delta", delta: "high" }; })() as unknown).mockReturnValueOnce((async function* () { yield { type: "text_delta", delta: "ans" }; yield { type: "done", message: { usage: { cost: { total: 0.001 } } } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(110); expect(state.lastDecision?.tier).toBe("high");
  });
  it("classifier failure all models", async () => {
    state.currentConfig = { profiles: { balanced: { high: { models: ["openai/gpt-high"] } as unknown, medium: { models: ["openai/mini"] } as unknown } }, classifierModels: [{ model: "openai/gpt" } as unknown], historySize: 0 } as RouterConfig;
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off"); makeReg; registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    // make find return undefined for classifier model to fail
    state.currentModelRegistry = { find: () => undefined, getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }), getProvider: () => ({ streamSimple }) } as unknown as ExtensionContext["modelRegistry"];
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(s.events.some((e) => (e as { type: string }).type === "error" && (e as { error: { errorMessage: string } }).error.errorMessage.includes("Classifier failed"))).toBe(true);
  });
  it("truncation", async () => {
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    let passed: Context | null = null; streamSimple.mockImplementation((_m: unknown, c: Context) => { passed = c; return (async function* () { yield { type: "text_delta", delta: "done" }; yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown; });
    opts.streamSimple(mdl("balanced", 10000), { systemPrompt: "sys", messages: [{ role: "user", content: "a".repeat(8000), timestamp: 1 } as unknown, { role: "user", content: "b".repeat(8000), timestamp: 2 } as unknown, { role: "user", content: "c".repeat(2000), timestamp: 3 } as unknown] } as unknown); await wait(); expect(passed).not.toBeNull(); expect((passed as unknown as Context).messages.length).toBeLessThan(3);
  });
  it("fallback retries with cost", async () => {
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockImplementation((m: Model<Api>) => m.id === "gpt-4o-mini" ? (async function* () { throw new Error("primary failed"); })() as unknown : (async function* () { yield { type: "text_delta", delta: "fallback" }; yield { type: "done", message: { usage: { cost: { total: 0.0005 } } } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(state.accumulatedCost).toBe(0.0005); expect(state.lastDecision?.isFallback).toBe(true);
  });
  it("all failed via memory", async () => {
    state.failedByChain.set("route:balanced:medium", new Set(["openai/gpt-4o-mini", "google/gemini-1.5-flash"])); registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(s.events.some((e) => (e as { type: string }).type === "error" && (e as { error: { errorMessage: string } }).error.errorMessage.includes("All models"))).toBe(true);
  });
  it("aborted signal", async () => {
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    const c = new AbortController(); c.abort(); opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]), { signal: c.signal } as unknown); await wait(); expect(s.events.some((e) => (e as { type: string }).type === "done")).toBe(true); expect(state.accumulatedCost).toBe(0);
  });
  it("NON_RETRYABLE after content + router provider skip", async () => {
    state.currentConfig = { profiles: { balanced: { medium: { models: ["router/other", "openai/gpt"] } as unknown } } } as RouterConfig;
    registerRouterProvider(pi, state, acts); const s = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    // first model is router/other -> skipped, second returns content then error -> NON_RETRYABLE, but fallback chain ends
    // to test NON_RETRYABLE branch, use single model with content+error
    state.currentConfig = { profiles: { balanced: { medium: { models: ["openai/gpt"] } as unknown } } } as RouterConfig;
    // re-register after config change
    state.lastRegisteredModels = ""; registerRouterProvider(pi, state, acts); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "part" }; yield { type: "error", error: { errorMessage: "fail" } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(true);
    // also verify router skip was handled in delegate loop (no error thrown for router ref)
    state.currentConfig = { profiles: { balanced: { medium: { models: ["router/other", "openai/gpt2"] } as unknown } } } as RouterConfig; state.lastRegisteredModels = ""; registerRouterProvider(pi, state, acts); const s2 = new S(); vi.mocked(createAssistantMessageEventStream).mockReturnValue(s2 as unknown as never);
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "a" }; yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }])); await wait(); expect(s2.events.some((e) => (e as { type: string }).type === "text_delta")).toBe(true);
  });
});
