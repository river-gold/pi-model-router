import { describe, expect, it, vi } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import type { Router } from "../src/types";
import {
  createVirtualModel,
  createVirtualModelRegistrar,
  routerLimits,
  type RouterRouteState,
} from "../src/virtualModel";
import { makeFakeExtensionContext, makeFakeModel, makeFakePi, makeFakeRegistry } from "./helpers";

const physical = (id: string): Model<Api> => makeFakeModel({ provider: "p", id });

const makeCtx = (
  models: string[],
  auth: { ok: boolean; apiKey?: string } = { ok: true, apiKey: "k" },
  configuredAuth: (model: Model<Api>) => boolean = () => true,
) => {
  const registry = makeFakeRegistry({
    find: (provider: string, id: string) =>
      provider === "p" && models.includes(id) ? physical(id) : undefined,
    getApiKeyAndHeaders: vi.fn().mockResolvedValue(auth),
    hasConfiguredAuth: configuredAuth,
  });
  return makeFakeExtensionContext({ modelRegistry: registry });
};

const makeRequest = (
  over: Partial<ModelRouteRequest<RouterRouteState>> = {},
): ModelRouteRequest<RouterRouteState> => ({
  model: physical("router"),
  thinkingLevel: "medium",
  reason: "user",
  messages: [],
  ...over,
});

const record = () => vi.fn();

describe("가상 모델 route 계약", () => {
  it("user 요청은 tier의 첫 후보를 고른다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a", "p/b"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(makeRequest(), makeCtx(["a", "b"]));
    expect(result.model.id).toBe("a");
    expect(result.thinkingLevel).toBe("medium");
  });

  it("모델별 #effort를 반환 thinking level로 쓴다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a#high"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(makeRequest(), makeCtx(["a"]));
    expect(result.thinkingLevel).toBe("high");
  });

  it("continuation은 직전 물리 모델과 thinking level을 재사용한다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest({
        reason: "continuation",
        previous: { model: physical("b"), thinkingLevel: "low" },
      }),
      makeCtx(["a", "b"]),
    );
    expect(result.model.id).toBe("b");
    expect(result.thinkingLevel).toBe("low");
  });

  it("continuation에 직전 thinking level이 없으면 요청 레벨을 쓴다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest({ reason: "continuation", previous: { model: physical("b") } }),
      makeCtx(["a", "b"]),
    );
    expect(result.thinkingLevel).toBe("medium");
  });

  it("minimal thinking은 minimal tier로 매핑한다", async () => {
    const routers: Record<string, Router> = {
      r: { minimal: { models: ["p/a"] }, medium: { models: ["p/b"] } },
    };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest({ thinkingLevel: "minimal" }),
      makeCtx(["a", "b"]),
    );
    expect(result.model.id).toBe("a");
  });

  it("random 라우터는 선택을 state에 저장하고 재사용한다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const routers: Record<string, Router> = {
      r: { random: true, medium: { models: ["p/a", "p/b"] } },
    };
    const model = createVirtualModel(routers, "r", undefined, record());
    const first = await model.route(makeRequest(), makeCtx(["a", "b"]));
    expect(first.model.id).toBe("a");
    const saved = first.state;
    expect(saved?.selections.medium).toBe("p/a");
    const second = await model.route(makeRequest({ state: saved }), makeCtx(["a", "b"]));
    expect(second.model.id).toBe("a");
    expect(second.state).toBe(saved);
    vi.restoreAllMocks();
  });

  it("random state에 없는 선택이면 다시 뽑는다", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const routers: Record<string, Router> = {
      r: { random: true, medium: { models: ["p/a", "p/b"] } },
    };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest({ state: { selections: { medium: "p/missing" } } }),
      makeCtx(["a", "b"]),
    );
    expect(result.model.id).toBe("b");
    vi.restoreAllMocks();
  });

  it("retry는 실패한 모델을 제외하고 다음 후보를 고른다", async () => {
    const routers: Record<string, Router> = {
      r: { medium: { models: ["p/a#high", "p/b"] } },
    };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest({ reason: "retry", failed: { model: physical("a"), message: {} as never } }),
      makeCtx(["a", "b"]),
    );
    expect(result.model.id).toBe("b");
  });

  it("retry에 실패 정보가 없으면 첫 후보를 고른다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a", "p/b"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(makeRequest({ reason: "retry" }), makeCtx(["a", "b"]));
    expect(result.model.id).toBe("a");
  });

  it("retry에서 실패 모델이 유일 후보면 그대로 다시 쓴다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest({ reason: "retry", failed: { model: physical("a"), message: {} as never } }),
      makeCtx(["a"]),
    );
    expect(result.model.id).toBe("a");
  });

  it("router provider 후보는 건너뛴다", async () => {
    const routers: Record<string, Router> = {
      r: { medium: { models: ["router/other", "p/a"] } },
    };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(makeRequest(), makeCtx(["a"]));
    expect(result.model.id).toBe("a");
  });

  it("pi가 인증된 provider로 보지 않는 후보는 건너뛴다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a", "p/b"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    const result = await model.route(
      makeRequest(),
      makeCtx(["a", "b"], { ok: true, apiKey: "k" }, (candidate) => candidate.id === "b"),
    );
    expect(result.model.id).toBe("b");
  });

  it("인정되지 않는 후보만 있으면 throw한다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    await expect(
      model.route(
        makeRequest(),
        makeCtx(["a"], { ok: true, apiKey: "k" }, () => false),
      ),
    ).rejects.toThrow("no usable model");
  });

  it("자격 증명 없는 후보만 있으면 throw한다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    await expect(model.route(makeRequest(), makeCtx(["a"], { ok: false }))).rejects.toThrow(
      "no usable model",
    );
  });

  it("물리 모델이 없으면 throw한다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/missing"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    await expect(model.route(makeRequest(), makeCtx([]))).rejects.toThrow("no usable model");
  });

  it("해석 가능한 tier가 없으면 throw한다", async () => {
    const routers: Record<string, Router> = { r: {} };
    const model = createVirtualModel(routers, "r", undefined, record());
    await expect(model.route(makeRequest(), makeCtx(["a"]))).rejects.toThrow("no resolvable tier");
  });

  it("등록 후 라우터가 사라지면 throw한다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const model = createVirtualModel(routers, "r", undefined, record());
    delete routers.r;
    await expect(model.route(makeRequest(), makeCtx(["a"]))).rejects.toThrow(
      "no longer configured",
    );
  });

  it("결정을 record로 전달한다", async () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    const recorder = record();
    const model = createVirtualModel(routers, "r", undefined, recorder);
    await model.route(makeRequest(), makeCtx(["a"]));
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({ router: "r", tier: "medium", targetModelId: "a" }),
    );
  });
});

describe("routerLimits", () => {
  it("tier 중 가장 큰 limit을 고른다", () => {
    const registry = makeFakeRegistry({
      find: (provider: string, id: string) => physical(id),
    });
    const routers: Record<string, Router> = {
      r: {
        medium: { models: ["p/a"], contextWindow: 150000, maxTokens: 20000 },
        high: { models: ["p/b"], contextWindow: 200000, maxTokens: 30000 },
      },
    };
    expect(routerLimits(routers, "r", registry)).toEqual({
      contextWindow: 200000,
      maxTokens: 30000,
    });
  });

  it("registry가 없으면 기본값을 쓴다", () => {
    const routers: Record<string, Router> = { r: { medium: { models: ["p/a"] } } };
    expect(routerLimits(routers, "r", undefined)).toEqual({
      contextWindow: 128000,
      maxTokens: 16384,
    });
  });
});

describe("createVirtualModelRegistrar", () => {
  it("라우터를 등록하고 사라진 라우터는 해제한다", () => {
    const pi = makeFakePi();
    const register = createVirtualModelRegistrar(pi);
    register({ routers: { a: { medium: { models: ["p/x"] } }, b: {} } }, undefined, record());
    expect(pi.registerVirtualModel).toHaveBeenCalledTimes(2);
    register({ routers: { a: { medium: { models: ["p/x"] } } } }, undefined, record());
    expect(pi.unregisterVirtualModel).toHaveBeenCalledWith("router", "b");
  });
});
