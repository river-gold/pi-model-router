import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { RouterConfig } from "../src/types";
import { normalizeConfig } from "../src/config";
import { registerRouterProvider } from "../src/provider";
import {
  makeFakeModel,
  makeFakePi,
  makeFakeProvider,
  makeFakeProviderState,
  makeFakeRegistry,
} from "./helpers";

const route = async (tiers: Record<string, unknown>, thinking: ThinkingLevel = "off") => {
  const raw = {
    classifierModels: ["@@typesafe/jev-latest", "@@agy/example"],
    tierGuides: "유효하지 않은 이전 설정",
    historySize: -1,
    routeEveryTurn: "유효하지 않음",
    typesafeConfidenceThreshold: -1,
    routers: { test: { ...tiers, classifierModels: ["@@agy/example"] } },
  };
  const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
  expect(warnings).toEqual([]);
  let registered: Parameters<ExtensionAPI["registerProvider"]>[1] | undefined;
  const pi = makeFakePi({
    getThinkingLevel: () => thinking,
    registerProvider: (_name, provider) => {
      registered = provider;
    },
  });
  const registry = makeFakeRegistry({
    find: (_provider, id) => makeFakeModel({ id }),
    getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key", headers: {} }),
    getProvider: () =>
      makeFakeProvider({
        streamSimple: () =>
          (async function* () {
            yield { type: "done", message: { usage: { cost: { total: 0 } } } };
          })() as never,
      }),
  });
  const state = makeFakeProviderState({ currentConfig: config, currentModelRegistry: registry });
  registerRouterProvider(pi, state, {
    persistState: vi.fn(),
    recordDebugDecision: vi.fn(),
    updateStatus: vi.fn(),
  });
  const stream = registered!.streamSimple!(makeFakeModel({ id: "test" }), {
    messages: [{ role: "user", content: "안녕", timestamp: 1 }],
  });
  for await (const _event of stream) {
    /* 응답이 완료될 때까지 소비 */
  }
  return state.lastDecision;
};

describe("thinking off 라우팅", () => {
  it("off tier를 선택하고 기존 분류기 설정을 실행하지 않는다", async () => {
    const decision = await route({
      off: { models: ["openai/off-model"] },
      minimal: { models: ["openai/min-model"] },
    });
    expect(decision?.tier).toBe("off");
    expect(decision?.targetModelId).toBe("off-model");
  });
  it("off tier가 없으면 minimal부터 폴백한다", async () => {
    const decision = await route({
      minimal: { models: ["openai/min-model"] },
      medium: { models: ["openai/med-model"] },
    });
    expect(decision?.tier).toBe("minimal");
    expect(decision?.targetModelId).toBe("min-model");
  });
  it("off만 설정된 라우터도 동작한다", async () => {
    const decision = await route({ off: { models: ["openai/off-model"] } });
    expect(decision?.tier).toBe("off");
    expect(decision?.targetModelId).toBe("off-model");
  });
  it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
    "thinking %s는 같은 이름의 tier를 선택한다",
    async (thinking) => {
      const tiers = Object.fromEntries(
        ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((tier) => [
          tier,
          { models: [`openai/${tier}-model`] },
        ]),
      );
      const decision = await route(tiers, thinking);
      expect(decision?.tier).toBe(thinking);
      expect(decision?.targetModelId).toBe(`${thinking}-model`);
    },
  );
  it("off tier가 다른 tier에 위임한 모델을 사용한다", async () => {
    const decision = await route({
      off: { models: ["@test#minimal"] },
      minimal: { models: ["openai/delegated"] },
    });
    expect(decision?.tier).toBe("off");
    expect(decision?.targetModelId).toBe("delegated");
  });
  it("off에서 minimal이 없으면 low가 medium보다 우선한다", async () => {
    const decision = await route({
      low: { models: ["openai/low"] },
      medium: { models: ["openai/medium"] },
    });
    expect(decision?.tier).toBe("low");
    expect(decision?.targetModelId).toBe("low");
  });
});
