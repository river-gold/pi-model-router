import { describe, it, expect, vi } from "vitest";
import routerExtension from "../index";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

vi.mock("@earendil-works/pi-ai", () => ({ createAssistantMessageEventStream: vi.fn() }));
const streamSimple = vi.fn();

describe("index provider integration", () => {
	it("covers index getters via provider stream", async () => {
		const mockPi:any = {
			registerProvider: vi.fn((name, opts) => {
				// capture opts
				(mockPi as any)._providerOpts = opts;
			}),
			registerCommand: vi.fn(),
			setModel: vi.fn().mockResolvedValue(true),
			appendEntry: vi.fn(),
			on: vi.fn((e,h)=>{}),
			getThinkingLevel: vi.fn().mockReturnValue("medium"),
		};
		routerExtension(mockPi);
		const opts = (mockPi as any)._providerOpts;
		expect(opts).toBeDefined();
		expect(opts.models.length).toBeGreaterThan(0);
		// call streamSimple to trigger state getters
		const MockStream = class { events:any[]=[]; push(e:any){this.events.push(e);} end(){} };
		const stream = new MockStream();
		(createAssistantMessageEventStream as any).mockReturnValue(stream as any);
		const reg = {
			find: vi.fn((p:string,id:string)=> ({ provider:p, id, reasoning:true, contextWindow:5000 } as any)),
			getApiKeyAndHeaders: async()=>({ ok:true, apiKey:"k", headers:{} }),
			getProvider: ()=>({ streamSimple }),
		};
		// Need to set currentModelRegistry via session_start to have registry available
		// Simulate session_start
		const listeners:any[] = [];
		mockPi.on = vi.fn((e:string,h:Function)=>{ listeners.push({e,h}); });
		// re-init with proper listeners capturing
		const mockPi2:any = {
			registerProvider: vi.fn((n,o)=>{ mockPi2._opts=o; }),
			registerCommand: vi.fn(),
			setModel: vi.fn().mockResolvedValue(true),
			appendEntry: vi.fn(),
			on: vi.fn((e:string,h:Function)=>{ if(e==="session_start") mockPi2._sessionH=h; }),
			getThinkingLevel: vi.fn().mockReturnValue("medium"),
		};
		routerExtension(mockPi2);
		const ctx:any = {
			cwd:"/tmp",
			modelRegistry: reg,
			model:{ provider:"router", id: opts.models[0].id },
			sessionManager:{ getBranch: ()=>[] },
			ui:{ setStatus: vi.fn(), setHiddenThinkingLabel: vi.fn(), notify: vi.fn(), theme:{ fg:(_:string,t:string)=>t }, setWorkingMessage: vi.fn() },
		};
		await mockPi2._sessionH({}, ctx);
		// now provider should have registry
		const providerOpts = mockPi2._opts;
		const s = new MockStream();
		(createAssistantMessageEventStream as any).mockReturnValue(s as any);
		streamSimple.mockReturnValue((async function*(){ yield { type:"text_delta", delta:"hi" }; yield { type:"done", message:{ usage:{ cost:{ total:0 } } } }; })() as any);
		providerOpts.streamSimple({ id: opts.models[0].id, provider:"router", contextWindow:100000 } as any, { messages:[{ role:"user", content:"hi" }] } as any);
		await new Promise(r=>setTimeout(r,80));
		expect(s.events.length).toBeGreaterThan(0);
	});
});
