import { vi } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
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

export const makeFakeRegistry = (over: Partial<ModelRegistry> = {}): ModelRegistry =>
  Object.assign(
    {
      refresh: vi.fn(),
      getError: vi.fn(),
      getAll: vi.fn(),
      getAvailable: vi.fn(),
      find: vi.fn(),
      findOfType: vi.fn(),
      hasConfiguredAuth: vi.fn(),
      getApiKeyAndHeaders: vi.fn(),
      getProviderAuthStatus: vi.fn(),
      getProvider: vi.fn(),
      getProviderDisplayName: vi.fn(),
      getProviderAuth: vi.fn(),
      getApiKeyForProvider: vi.fn(),
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
      registerVirtualModel: vi.fn(),
      unregisterVirtualModel: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    },
    over,
  );

export const makeFakeDecision = (over: Partial<RoutingDecision> = {}): RoutingDecision =>
  Object.assign(
    {
      router: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt",
      targetLabel: "openai/gpt",
      reasoning: "test",
      timestamp: 0,
    },
    over,
  );
