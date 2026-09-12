import { vi } from "vitest";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { RouterProviderState } from "../src/provider/state";
import type { RoutingDecision } from "../src/types";

/** 부분 재정의와 Object.assign 교차로 완전한 fake를 만든다. 캐스팅 없음. */
export const makeFakeModel = (over: Partial<Model<Api>> = {}): Model<Api> =>
  Object.assign(
    {
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://example.test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8000,
      maxTokens: 1024,
    },
    over,
  );

export const makeFakeProvider = (over: Partial<Provider> = {}): Provider =>
  Object.assign(
    {
      id: "test-provider",
      name: "test-provider",
      auth: {},
      getModels: (): readonly Model<Api>[] => [],
      stream: vi.fn(),
      streamSimple: vi.fn(),
    },
    over,
  );

export const makeFakeRegistry = (over: Partial<ModelRegistry> = {}): ModelRegistry =>
  Object.assign(
    {
      refresh: vi.fn(),
      getError: vi.fn(),
      getAll: vi.fn(),
      getAvailable: vi.fn(),
      find: vi.fn(),
      hasConfiguredAuth: vi.fn(),
      getApiKeyAndHeaders: vi.fn(),
      getProviderAuthStatus: vi.fn(),
      getProvider: vi.fn(),
      complete: vi.fn(),
      getProviderDisplayName: vi.fn(),
      getProviderAuth: vi.fn(),
      getApiKeyForProvider: vi.fn(),
      isUsingOAuth: vi.fn(),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      getRegisteredProviderConfig: vi.fn(),
      getRegisteredNativeProvider: vi.fn(),
      getRegisteredProviderIds: vi.fn(),
    },
    over,
  );

export const makeFakeUi = (over: Partial<ExtensionContext["ui"]> = {}): ExtensionContext["ui"] =>
  Object.assign(
    {
      select: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      notify: vi.fn(),
      onTerminalInput: vi.fn(),
      setStatus: vi.fn(),
      setWorkingMessage: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingIndicator: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      setWidget: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setTitle: vi.fn(),
      pasteToEditor: vi.fn(),
      setEditorText: vi.fn(),
      getEditorText: vi.fn(),
      editor: vi.fn(),
      addAutocompleteProvider: vi.fn(),
      setEditorComponent: vi.fn(),
      getEditorComponent: vi.fn(),
      getAllThemes: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      getToolsExpanded: vi.fn(),
      setToolsExpanded: vi.fn(),
    },
    over,
  );

export const makeFakeSessionManager = (
  over: Partial<ExtensionContext["sessionManager"]> = {},
): ExtensionContext["sessionManager"] =>
  Object.assign(
    {
      getCwd: vi.fn(),
      getSessionDir: vi.fn(),
      getSessionId: vi.fn(),
      getSessionFile: vi.fn(),
      getLeafId: vi.fn(),
      getLeafEntry: vi.fn(),
      getEntry: vi.fn(),
      getLabel: vi.fn(),
      getBranch: vi.fn(),
      buildContextEntries: vi.fn(),
      getHeader: vi.fn(),
      getEntries: vi.fn(),
      getTree: vi.fn(),
      getSessionName: vi.fn(),
    },
    over,
  );

export const makeFakeExtensionContext = (over: Partial<ExtensionContext> = {}): ExtensionContext =>
  Object.assign(
    {
      ui: makeFakeUi(),
      mode: "tui",
      hasUI: false,
      cwd: "/cwd",
      sessionManager: makeFakeSessionManager(),
      modelRegistry: makeFakeRegistry(),
      model: undefined,
      scopedModels: [],
      isIdle: vi.fn(),
      isProjectTrusted: vi.fn(),
      signal: undefined,
      abort: vi.fn(),
      hasPendingMessages: vi.fn(),
      shutdown: vi.fn(),
      getContextUsage: vi.fn(),
      compact: vi.fn(),
      getSystemPrompt: vi.fn(),
    },
    over,
  );

export const makeFakePi = (over: Partial<ExtensionAPI> = {}): ExtensionAPI =>
  Object.assign(
    {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
      registerMessageRenderer: vi.fn(),
      registerMarkdownTransformer: vi.fn(),
      registerEntryRenderer: vi.fn(),
      sendMessage: vi.fn(),
      sendUserMessage: vi.fn(),
      appendEntry: vi.fn(),
      setSessionName: vi.fn(),
      getSessionName: vi.fn(),
      setLabel: vi.fn(),
      exec: vi.fn(),
      getActiveTools: vi.fn(),
      getAllTools: vi.fn(),
      setActiveTools: vi.fn(),
      getCommands: vi.fn(),
      setModel: vi.fn(),
      getThinkingLevel: vi.fn(),
      setThinkingLevel: vi.fn(),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    },
    over,
  );

export const makeFakeDecision = (over: Partial<RoutingDecision> = {}): RoutingDecision =>
  Object.assign(
    {
      profile: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt",
      targetLabel: "openai/gpt",
      reasoning: "test",
      timestamp: 0,
    },
    over,
  );

export const makeFakeProviderState = (
  over: Partial<RouterProviderState> = {},
): RouterProviderState =>
  Object.assign(
    {
      lastRegisteredModels: "",
      currentConfig: { profiles: {} },
      currentModelRegistry: undefined,
      lastExtensionContext: undefined,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    },
    over,
  );

export const fakeMessage = (over: Partial<AssistantMessage> = {}): AssistantMessage =>
  Object.assign(
    {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      api: "openai-completions",
      provider: "openai",
      model: "test-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    },
    over,
  );

export const textDeltaEvent = (delta: string): AssistantMessageEvent => ({
  type: "text_delta",
  contentIndex: 0,
  delta,
  partial: fakeMessage(),
});

export const doneEventWithCost = (total: number): AssistantMessageEvent => ({
  type: "done",
  reason: "stop",
  message: {
    ...fakeMessage(),
    usage: {
      ...fakeMessage().usage,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
    },
  },
});

export const errorEvent = (errorMessage: string): AssistantMessageEvent => ({
  type: "error",
  reason: "error",
  error: { ...fakeMessage(), errorMessage },
});

/** 실제 EventStream에 이벤트를 미리 적재한다. for-await로 소진된다. */
export const streamOf = (...events: AssistantMessageEvent[]) => {
  const stream = createAssistantMessageEventStream();
  for (const event of events) stream.push(event);
  stream.end();
  return stream;
};

/** 실제 스트림 + push 스파이. 호출자 스트림 fake용. */
export const makeStreamSpy = () => {
  const stream = createAssistantMessageEventStream();
  const push = vi.spyOn(stream, "push");
  return { stream, push };
};

export const fakeSignal = (aborted: boolean): AbortSignal => ({
  aborted,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
  onabort: null,
  reason: aborted ? new Error("aborted") : undefined,
  throwIfAborted: (): void => {
    if (aborted) throw new Error("aborted");
  },
});
