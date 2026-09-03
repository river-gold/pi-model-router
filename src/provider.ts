/* oxlint-disable */
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RoutingDecision, RouterTier } from "./types";
import { profileNames, ROUTER_TIERS, resolveEffectiveClassifier } from "./config";
import { decideInitialDecision } from "./provider/routing";
import { delegateToTierModels } from "./provider/delegate";
import { validateProviderState } from "./provider/validation";
import { createCommitMutex, type RouterProviderState } from "./provider/state";
import { normalizeDelegateError, pushStreamError } from "./provider/error";
import { safePersist, safeUpdateStatus } from "./provider/safe";
import { applyClassifierIfNeeded } from "./provider/classifier";
import { buildModelDefinitions, buildModelsKey } from "./provider/models";
import { streamDelegated, modelWithAuthBaseUrl } from "./stream";
import { chainKeyForRoute, isRecordablePreStreamError } from "./failureMemory";
import { ESCALATION_TOOL } from "./escalation";

export {
  streamDelegated,
  createAssistantMessageEventStream,
  modelWithAuthBaseUrl,
  chainKeyForRoute,
  isRecordablePreStreamError,
};
export { normalizeDelegateError, pushStreamError } from "./provider/error";
export { safeUpdateStatus, safePersist } from "./provider/safe";
export { applyClassifierIfNeeded } from "./provider/classifier";
export { buildModelDefinitions, buildModelsKey } from "./provider/models";

export const registerRouterProvider = (
  pi: ExtensionAPI,
  state: RouterProviderState,
  actions: {
    persistState: () => void;
    recordDebugDecision: (d: RoutingDecision) => void;
    updateStatus: (ctx: ExtensionContext) => void;
  },
) => {
  const { withCommitMutex } = createCommitMutex();
  const modelDefinitions = buildModelDefinitions(state.currentConfig, state.currentModelRegistry);
  const modelsKey = buildModelsKey(modelDefinitions);
  if (state.lastRegisteredModels === modelsKey) return;
  pi.registerProvider("router", {
    baseUrl: "router://local",
    apiKey: "pi-model-router",
    api: "router-local-api",
    models: modelDefinitions,
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const stream = createAssistantMessageEventStream();
      (async () => {
        try {
          const registry: ExtensionContext["modelRegistry"] | undefined =
            state.currentModelRegistry;
          const profile: RouterProfile | undefined = state.currentConfig.profiles[model.id];
          // @ts-ignore TS2775 non-null assertion requires explicit type, already provided
          validateProviderState(
            registry as ExtensionContext["modelRegistry"] | undefined,
            profile,
            model.id,
          );
          const snap = state.lastDecision;
          await withCommitMutex(async () => {
            state.selectedProfile = model.id;
            state.routerEnabled = true;
          });
          if (options?.signal?.aborted) throw new Error("aborted");
          const isToolLoop =
            context.messages[context.messages.length - 1]?.role === "toolResult" &&
            snap?.profile === model.id &&
            snap !== undefined;
          let decision = decideInitialDecision({
            profileName: model.id,
            profile: profile as RouterProfile,
            context,
            snapshotLastDecision: snap,
            thinkingLevel: pi.getThinkingLevel(),
            isToolLoop,
            singleTier: ROUTER_TIERS.find((t) => (profile as RouterProfile)[t]) as
              | RouterTier
              | undefined,
            validTierCount: ROUTER_TIERS.filter((t) => (profile as RouterProfile)[t]).length,
          });
          const { source } = resolveEffectiveClassifier(
            profile as RouterProfile,
            state.currentConfig.classifierModels,
          );
          const isSingleTier =
            ROUTER_TIERS.filter((t) => (profile as RouterProfile)[t]).length === 1;
          const isToolLoopNow =
            context.messages[context.messages.length - 1]?.role === "toolResult" &&
            snap?.profile === model.id;
          decision = await applyClassifierIfNeeded(
            profile as RouterProfile,
            decision,
            model.id,
            registry as ExtensionContext["modelRegistry"],
            state,
            context,
            options?.signal,
            isSingleTier,
            isToolLoopNow,
            pi.getThinkingLevel(),
            source,
          );
          await withCommitMutex(async () => {
            state.lastDecision = decision;
          });
          actions.recordDebugDecision(decision);
          safeUpdateStatus(state, actions);
          const isMultiTier = ROUTER_TIERS.filter((t) => (profile as RouterProfile)[t]).length > 1;
          const shouldInject = pi.getThinkingLevel() === "off" && isMultiTier;
          let effectiveContext = context;
          if (
            shouldInject &&
            !(context.tools ?? []).some((t: { name: string }) => t.name === ESCALATION_TOOL.name)
          )
            effectiveContext = {
              ...context,
              tools: [...(context.tools ?? []), ESCALATION_TOOL as never],
            };
          const res = await delegateToTierModels({
            registry: registry as ExtensionContext["modelRegistry"],
            profile: profile as RouterProfile,
            decision,
            routerModel: model,
            context: effectiveContext,
            options,
            state,
            withCommitMutex,
            stream,
            recordDebugDecision: actions.recordDebugDecision,
          });
          if (!res.success) throw normalizeDelegateError(res.lastError);
          stream.end();
        } catch (error) {
          pushStreamError(stream, model, error);
        } finally {
          safePersist(actions);
        }
      })();
      return stream;
    },
  });
  state.lastRegisteredModels = modelsKey;
};
