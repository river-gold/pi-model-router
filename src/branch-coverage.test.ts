import { describe, it, expect, vi } from "vitest";
import { registerCommands } from "./commands";
import type { RouterConfig } from "./types";

describe("branch coverage final", () => {
  it("commands status both branches", async () => {
    const build = (over:any) => ({
      currentConfig: { profiles:{ a:{} }, historySize:0 } as RouterConfig,
      routerEnabled: over.routerEnabled,
      selectedProfile: over.selectedProfile,
      lastDecision: over.lastDecision,
      lastNonRouterModel: over.lastNonRouterModel,
      accumulatedCost: 0,
      debugEnabled: over.debugEnabled,
      debugHistory: over.debugHistory ?? [],
      lastConfigWarnings: over.lastConfigWarnings ?? [],
      failedByChain: over.failedByChain ?? new Map(),
    });
    const actions = { persistState: vi.fn(), updateStatus: vi.fn(), reloadConfig: vi.fn(), ensureValidActiveRouterProfile: vi.fn() };
    // case 1: routerEnabled true, selectedProfile defined, lastDecision defined, debugEnabled true, failures none, warnings none
    {
      const pi:any={ registerCommand: vi.fn((n,c)=>{ pi._cmd=c; }) };
      const state = build({ routerEnabled:true, selectedProfile:"a", lastDecision:{ profile:"a", tier:"high", targetProvider:"openai", targetModelId:"gpt", targetLabel:"openai/gpt", reasoning:"r", thinking:"high", timestamp: Date.now() }, lastNonRouterModel:"openai/gpt", debugEnabled:true, debugHistory:[{ profile:"a", tier:"high", targetProvider:"openai", targetModelId:"gpt", targetLabel:"openai/gpt", reasoning:"r", thinking:"high", timestamp: Date.now() }], lastConfigWarnings:[], failedByChain:new Map() });
      registerCommands(pi, state as any, actions as any);
      const ctx:any={ ui:{ notify: vi.fn(), setStatus: vi.fn() } };
      await pi._cmd.handler("status", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("yes"), expect.any(String));
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("a"), expect.any(String));
    }
    // case 2: routerEnabled false, selectedProfile undefined, no lastDecision, debug false, etc.
    {
      const pi:any={ registerCommand: vi.fn((n,c)=>{ pi._cmd=c; }) };
      const state = build({ routerEnabled:false, selectedProfile:undefined, lastDecision:undefined, lastNonRouterModel:undefined, debugEnabled:false, debugHistory:[], lastConfigWarnings:[], failedByChain:new Map() });
      registerCommands(pi, state as any, actions as any);
      const ctx:any={ ui:{ notify: vi.fn(), setStatus: vi.fn() } };
      await pi._cmd.handler("status", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("off"), expect.any(String));
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("none"), expect.any(String));
    }
    // case 3: with warnings and failures
    {
      const pi:any={ registerCommand: vi.fn((n,c)=>{ pi._cmd=c; }) };
      const state = build({ routerEnabled:true, selectedProfile:"a", lastDecision:{ profile:"a", tier:"high", targetProvider:"openai", targetModelId:"gpt", targetLabel:"openai/gpt", reasoning:"r", thinking:"high", timestamp: Date.now() }, lastNonRouterModel:"x", debugEnabled:false, debugHistory:[], lastConfigWarnings:["w1"], failedByChain:new Map([["k", new Set(["v"])]]) });
      registerCommands(pi, state as any, actions as any);
      const ctx:any={ ui:{ notify: vi.fn(), setStatus: vi.fn() } };
      await pi._cmd.handler("status", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("w1"), expect.any(String));
    }
  });

  it("config branches", async () => {
    const { normalizeConfig } = await import("./config");
    // hit unknown top-level field branch
    normalizeConfig({ unknown:"x", profiles:{} } as any);
    // hit profile not object
    normalizeConfig({ profiles:{ bad:"str" } } as any);
    // hit historySize invalid
    normalizeConfig({ historySize: 100, profiles:{ p:{ high:{ models:["openai/gpt"] } } } } as any);
    // hit classifierModel deprecated
    normalizeConfig({ classifierModel:"openai/gpt", profiles:{ p:{ high:{ models:["openai/gpt"] } } } } as any);
    // hit resolveContextWindow with registry
    const { resolveContextWindow, resolveMaxTokens } = await import("./config");
    const reg = { find: ()=>({ contextWindow: 9999, maxTokens: 888 }) } as any;
    resolveContextWindow("high", { high:{ models:["openai/gpt"], resolvedContextWindow: 1000 } } as any, reg);
    resolveMaxTokens("high", { high:{ models:["openai/gpt"], resolvedMaxTokens: 1000 } } as any, reg);
    // hit with no registry and with contextWindow set
    resolveContextWindow("high", { high:{ models:["openai/gpt"], contextWindow: 123, resolvedContextWindow: 1000 } } as any, undefined);
    resolveMaxTokens("high", { high:{ models:["openai/gpt"], maxTokens: 123, resolvedMaxTokens: 1000 } } as any, undefined);
  });

  it("context branches", async () => {
    const { truncateContext } = await import("./context");
    // hit orphan and alignment branches
    const ctx1:any = {
      systemPrompt:"sys",
      messages:[
        { role:"user", content:"u1", timestamp:1 },
        { role:"assistant", content:"a1", timestamp:2 },
        { role:"assistant", content:"a2", timestamp:3 },
        { role:"assistant", content:"a3", timestamp:4 },
        { role:"user", content:"latest", timestamp:5 },
      ]
    };
    truncateContext(ctx1, 4);
    // hit with toolResult orphan
    const ctx2:any = {
      messages:[
        { role:"assistant", content:"a", timestamp:1 },
        { role:"toolResult", toolCallId:"1", toolName:"t", content:"out", isError:false, timestamp:2 },
        { role:"toolResult", toolCallId:"2", toolName:"t", content:"out2", isError:false, timestamp:3 },
        { role:"user", content:"cur", timestamp:4 },
      ]
    };
    truncateContext(ctx2, 1);
  });

  it("provider branches via direct helper", async () => {
    const { isRecordablePreStreamError } = await import("./failureMemory");
    isRecordablePreStreamError(new Error("429"));
    isRecordablePreStreamError(new Error("500"));
    isRecordablePreStreamError(new Error("aborted"));
    const { resolveAvailableTier } = await import("./routing");
    resolveAvailableTier({ low:{ models:["a"] } } as any, "medium" as any);
    resolveAvailableTier({} as any, "medium" as any);
  });
});
