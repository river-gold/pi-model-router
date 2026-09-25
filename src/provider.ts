import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Router, RoutingDecision, RouterTier } from "./types";
import { resolveEffectiveClassifier, resolvableTiers } from "./config";
import { decideInitialDecision } from "./provider/routing";
import { delegateToTierModels, projectDecisionOntoFirstKeptCandidate } from "./provider/delegate";
import { validateProviderState } from "./provider/validation";
import { createCommitMutex, type RouterProviderState } from "./provider/state";
import { normalizeDelegateError, pushStreamError } from "./provider/error";
import { safePersist, safeUpdateStatus } from "./provider/safe";
import { applyClassifierIfNeeded } from "./provider/classifier";
import { buildModelDefinitions, buildModelsKey } from "./provider/models";
import { streamDelegated, modelWithAuthBaseUrl } from "./stream";
import { chainKeyForRoute, isRecordablePreStreamError } from "./failureMemory";

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
      void (async () => {
        try {
          const registry: ExtensionContext["modelRegistry"] | undefined =
            state.currentModelRegistry;
          const router: Router | undefined = state.currentConfig.routers[model.id];
          // @ts-ignore TS2775 non-null assertion requires explicit type, already provided
          // 아래 registry! 가 안전함: validateProviderState가 !registry에서 throw함.
          validateProviderState(registry, router, model.id);
          const snap = state.lastDecision;
          await withCommitMutex(async () => {
            state.selectedRouter = model.id;
            state.routerEnabled = true;
          });
          if (options?.signal?.aborted) throw new Error("aborted");
          const isToolLoop =
            context.messages[context.messages.length - 1]?.role === "toolResult" &&
            snap?.router === model.id &&
            snap !== undefined;
          const routers = state.currentConfig.routers;
          const liveTiers = resolvableTiers(routers, model.id);
          let decision = decideInitialDecision({
            routerName: model.id,
            router: router as Router,
            context,
            snapshotLastDecision: snap,
            thinkingLevel: pi.getThinkingLevel(),
            isToolLoop,
            singleTier: liveTiers[0] as RouterTier | undefined,
            validTierCount: liveTiers.length,
            routers,
          });
          const { source } = resolveEffectiveClassifier(
            router as Router,
            state.currentConfig.classifierModels,
            routers,
          );
          const isSingleTier = liveTiers.length === 1;
          const isToolLoopNow =
            context.messages[context.messages.length - 1]?.role === "toolResult" &&
            snap?.router === model.id;
          decision = await applyClassifierIfNeeded(
            router as Router,
            decision,
            model.id,
            registry!,
            state,
            context,
            options?.signal,
            isSingleTier,
            isToolLoopNow,
            pi.getThinkingLevel(),
            source,
            options?.sessionId,
            routers,
          );
          decision = projectDecisionOntoFirstKeptCandidate(
            decision,
            router as Router,
            routers,
            state.failedByChain,
          );
          await withCommitMutex(async () => {
            state.lastDecision = decision;
          });
          actions.recordDebugDecision(decision);
          safeUpdateStatus(state, actions);
          const res = await delegateToTierModels({
            registry: registry!,
            router: router as Router,
            routers,
            decision,
            routerModel: model,
            context,
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
