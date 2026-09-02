import { describe, it, expect, vi } from "vitest";
import { parseConfigFile } from "./config";
import { truncateContext } from "./context";
import type { Context, Message } from "@earendil-works/pi-ai";

vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => "/mock/agent" }));
vi.mock("node:fs", () => ({
	existsSync: (p:string) => p.includes("exists"),
	readFileSync: (p:string) => {
		if (p.includes("not-object")) return "123";
		if (p.includes("invalid-json")) return "{invalid";
		return "{}";
	}
}));

describe("remaining config", () => {
	it("parseConfigFile not-object", () => {
		const r = parseConfigFile("/some/exists-not-object.json");
		expect(r.warnings[0]).toContain("expected a JSON object");
	});
	it("parseConfigFile invalid json", () => {
		const r = parseConfigFile("/some/exists-invalid-json.json");
		expect(r.warnings[0]).toContain("Failed to parse");
	});
	it("mergeTier both existing and next", async () => {
		const { mergeConfig } = await import("./config");
		const base: any = { profiles: { p: { high: { models:["openai/a"], model:"openai/a" } } } };
		const over: any = { profiles: { p: { high: { models:["openai/b"] } } } };
		const m = mergeConfig(base, over);
		expect(m.profiles.p.high?.models).toEqual(["openai/b"]);
	});
});

describe("remaining context", () => {
	it("truncate with no user after startIndex hits aligned = messages.length", () => {
		const ctx: Context = {
			systemPrompt: "sys",
			messages: [
				{ role:"user", content:"u1", timestamp:1 } as unknown as Message,
				{ role:"assistant", content:"a1", timestamp:2 } as unknown as Message,
				{ role:"assistant", content:"a2", timestamp:3 } as unknown as Message,
				{ role:"assistant", content:"a3", timestamp:4 } as unknown as Message,
				{ role:"user", content:"latest", timestamp:5 } as unknown as Message,
			]
		};
		// limit 4 forces startIndex=3 which points to assistant a3, no user after, triggers aligned=messages.length
		const out = truncateContext(ctx, 4);
		expect(out.messages[out.messages.length-1].content).toBe("latest");
		expect(out.messages.length).toBe(1);
	});
	it("orphan handling when finalMessages starts with toolResult", () => {
		const ctx: Context = {
			messages: [
				{ role:"user", content:"u1", timestamp:1 } as unknown as Message,
				{ role:"assistant", content:"call", timestamp:2 } as unknown as Message,
				{ role:"toolResult", toolCallId:"1", toolName:"t", content:"out1", isError:false, timestamp:3 } as unknown as Message,
				{ role:"toolResult", toolCallId:"2", toolName:"t", content:"out2", isError:false, timestamp:4 } as unknown as Message,
				{ role:"user", content:"latest", timestamp:5 } as unknown as Message,
			]
		};
		const out = truncateContext(ctx, 3);
		// After truncation, should drop leading toolResults if they become orphan
		expect(out.messages[0].role).not.toBe("toolResult");
	});
});
