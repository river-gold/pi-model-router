import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RoutingDecision, RouterTier } from "./types";
import {
	profileNames,
	parseCanonicalModelRef,
	formatModelRef,
	ROUTER_TIERS,
	resolveContextWindow,
	resolveMaxTokens,
	resolveDelegatedReasoning,
	resolveEffectiveClassifier,
} from "./config";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./constants";
import {
	buildRoutingDecision,
	decideRouting,
	resolveAvailableTier,
	thinkingToTier,
} from "./routing";
import { runClassifierWithFallbacksDetailed } from "./classifier";
import { truncateContext } from "./context";
import { modelWithAuthBaseUrl, streamDelegated } from "./stream";
import {
	CLASSIFIER_CHAIN_KEY,
	chainKeyForRoute,
	normalizeFailedRef,
	isRecordablePreStreamError,
} from "./failureMemory";

export const waitForRegistry = async (state: {
	readonly currentModelRegistry: ExtensionContext["modelRegistry"] | undefined;
}): Promise<ExtensionContext["modelRegistry"] | undefined> => {
	return state.currentModelRegistry;
};

export const createErrorMessage = (
	model: Model<Api>,
	message: string,
): AssistantMessage => {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: message,
		timestamp: Date.now(),
	};
};

export const registerRouterProvider = (
	pi: ExtensionAPI,
	state: {
		lastRegisteredModels: string;
		readonly currentConfig: RouterConfig;
		readonly currentModelRegistry:
			| ExtensionContext["modelRegistry"]
			| undefined;
		readonly lastExtensionContext: ExtensionContext | undefined;
		selectedProfile: string | undefined;
		routerEnabled: boolean;
		lastDecision: RoutingDecision | undefined;
		accumulatedCost: number;
		readonly failedByChain: Map<string, Set<string>>;
	},
	actions: {
		persistState: () => void;
		recordDebugDecision: (decision: RoutingDecision) => void;
		updateStatus: (ctx: ExtensionContext) => void;
	},
) => {
	// Serialize commits to shared mutable state (lastDecision, accumulatedCost,
	// selectedProfile, routerEnabled) so concurrent router requests do not
	// interleave partial writes. Read path uses per-request snapshots.
	let commitMutex: Promise<void> = Promise.resolve();
	const withCommitMutex = async <T>(fn: () => T | Promise<T>): Promise<T> => {
		const prev = commitMutex;
		let release!: () => void;
		commitMutex = new Promise<void>((r) => {
			release = r;
		});
		await prev;
		try {
			return await fn();
		} finally {
			release();
		}
	};
	const profileList = profileNames(state.currentConfig);

	// Map profiles to their capacities
	const modelDefinitions = profileList.map((name) => {
		const profile = state.currentConfig.profiles[name];

		// Report the MAX context window and max output tokens across all tiers.
		// The honesty check + truncateContext handles the case where the
		// actually routed model is smaller.
		let maxContextWindow = DEFAULT_CONTEXT_WINDOW;
		let maxMaxTokens = DEFAULT_MAX_TOKENS;
		for (const tier of ROUTER_TIERS) {
			if (!profile[tier]) continue;
			const cw = resolveContextWindow(
				tier,
				profile,
				state.currentModelRegistry,
			);
			const mot = resolveMaxTokens(tier, profile, state.currentModelRegistry);
			if (cw > maxContextWindow) maxContextWindow = cw;
			if (mot > maxMaxTokens) maxMaxTokens = mot;
		}

		// Router models expose thinking levels so pi's effort/thinking level can
		// select the tier (off = auto/classifier). Delegated reasoning is clamped
		// per-target model via resolveDelegatedReasoning.
		return {
			id: name,
			name: `Router ${name}`,
			reasoning: true,
			thinkingLevelMap: {
				minimal: "minimal",
				low: "low",
				medium: "medium",
				high: "high",
				xhigh: "xhigh",
				max: "max",
			},
			input: ["text", "image"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: maxContextWindow,
			maxTokens: maxMaxTokens,
		};
	});

	const modelsKey = modelDefinitions
		.map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`)
		.join(",");
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
					// Wait for the router to be fully initialized (session_start sets currentModelRegistry).
					// This handles the race where subagents (e.g. from pi-dynamic-workflows) invoke
					// the router provider before session_start has fired in their context.
					const registry = await waitForRegistry(state);
					if (!registry) {
						throw new Error(
							"Router provider not initialized. session_start may not have fired.",
						);
					}
					const profile = state.currentConfig.profiles[model.id];
					if (!profile) {
						throw new Error(`Unknown router profile: ${model.id}`);
					}

					// Per-request isolation: snapshot shared state and work with locals.
					const snapshotLastDecision = state.lastDecision;

					await withCommitMutex(async () => {
						state.selectedProfile = model.id;
						state.routerEnabled = true;
					});

					if (options?.signal?.aborted) throw new Error("aborted");
					let decision: RoutingDecision = decideRouting(
						context,
						model.id,
						profile,
						snapshotLastDecision,
					);

					const lastMessageForLoop =
						context.messages[context.messages.length - 1];
					const isGoogleThinkingLoop =
						snapshotLastDecision?.targetProvider === "google" &&
						snapshotLastDecision?.thinking !== undefined &&
						snapshotLastDecision?.thinking !== "off";
					const isToolLoop =
						lastMessageForLoop?.role === "toolResult" &&
						snapshotLastDecision?.profile === model.id &&
						snapshotLastDecision !== undefined &&
						!isGoogleThinkingLoop;
					const shouldSkipClassifier = isToolLoop || isGoogleThinkingLoop;
					if (isToolLoop && snapshotLastDecision) {
						decision = buildRoutingDecision(
							model.id,
							profile,
							snapshotLastDecision.tier,
							`Preserved ${snapshotLastDecision.tier} tier during toolResult loop`,
							false,
						);
					}

					const singleTier = ROUTER_TIERS.find((t) => profile[t]) as
						| RouterTier
						| undefined;
					const validTierCount = ROUTER_TIERS.filter((t) => profile[t]).length;
					const isSingleTier = validTierCount === 1 && singleTier !== undefined;

					// pi's thinking level selects the tier directly; off = auto (classifier).
					const thinkingLevel = pi.getThinkingLevel();
					if (isSingleTier && !isToolLoop) {
						decision = buildRoutingDecision(
							model.id,
							profile,
							singleTier,
							`Single tier "${singleTier}" defined — skipping classifier/thinking mapping.`,
							false,
						);
					} else if (thinkingLevel !== "off" && !isToolLoop) {
						const preferred = thinkingToTier(thinkingLevel);
						const tier = resolveAvailableTier(profile, preferred);
						let reasoning = `Thinking level ${thinkingLevel} mapped to ${tier} tier.`;
						if (tier !== preferred) {
							reasoning = `Thinking level ${thinkingLevel} mapped to ${preferred} tier, resolved to ${tier} (${preferred} tier is not configured).`;
						}
						decision = buildRoutingDecision(
							model.id,
							profile,
							tier,
							reasoning,
							false,
						);
					}

					const {
						classifiers: effectiveClassifiers,
						source: classifierSource,
					} = resolveEffectiveClassifier(
						profile,
						state.currentConfig.classifierModels,
					);

					if (isSingleTier) {
						// already resolved above — skip classifier entirely regardless of thinkingLevel
					} else if (!shouldSkipClassifier && thinkingLevel === "off") {
						if (!effectiveClassifiers) {
							throw new Error(
								"No classifier available for auto (off) mode. Configure classifierModels or add a low tier.",
							);
						}
						if (options?.signal?.aborted) throw new Error("aborted");

						const effectiveHistorySize = state.currentConfig.historySize ?? 0;
						const classifierFailedSet =
							state.failedByChain.get(CLASSIFIER_CHAIN_KEY) ??
							new Set<string>();
						const { result: classifierResult, attempts } =
							await runClassifierWithFallbacksDetailed(
								effectiveClassifiers,
								registry,
								context,
								effectiveHistorySize,
								options?.signal,
								(entry) => {
									// Show only the model currently being requested.
									try {
										state.lastExtensionContext?.ui.setWorkingMessage(
											`Classifying via ${entry.source ?? classifierSource} (${entry.model}${entry.thinking ? `#${entry.thinking}` : ""})...`,
										);
									} catch {
										// Stale extension context — skip non-critical UI updates.
									}
								},
								classifierFailedSet,
							);
						// Persist classifier failures back to the shared map (runClassifierWithFallbacksDetailed mutates the set)
						if (classifierFailedSet.size > 0) {
							state.failedByChain.set(
								CLASSIFIER_CHAIN_KEY,
								classifierFailedSet,
							);
						}

						try {
							state.lastExtensionContext?.ui.setWorkingMessage(undefined);
						} catch {
							// Stale extension context — skip non-critical UI updates.
						}

						if (classifierResult) {
							const preferred = classifierResult.tier;
							const tier = resolveAvailableTier(profile, preferred);
							let reasoning = `Classifier: ${classifierResult.reasoning}`;
							if (tier !== preferred) {
								reasoning = `Resolved from ${preferred} to ${tier} tier (${preferred} tier is not configured). Original: ${reasoning}`;
							}
							decision = buildRoutingDecision(
								model.id,
								profile,
								tier,
								reasoning,
								true,
							);
						} else {
							const attempted = attempts
								.map(
									(a) =>
										`${a.model}${a.thinking ? `#${a.thinking}` : ""} (${a.error})`,
								)
								.join(", ");
							throw new Error(
								`Classifier failed to determine a tier. Source: ${classifierSource}. Attempted: ${attempted || "none"}. Models may be unregistered, missing API keys, or returned invalid format (expected "Tier: minimal|low|medium|high|xhigh|max").`,
							);
						}
					}

					const lastMessage = context.messages[context.messages.length - 1];
					const previousDecision = snapshotLastDecision;
					const isGoogleThinkingToolContinuation =
						lastMessage?.role === "toolResult" &&
						previousDecision?.profile === model.id &&
						previousDecision.targetProvider === "google" &&
						previousDecision.thinking !== undefined &&
						previousDecision.thinking !== "off" &&
						decision.targetProvider === "google" &&
						decision.thinking !== undefined &&
						decision.thinking !== "off" &&
						previousDecision.targetLabel !== decision.targetLabel;

					if (isGoogleThinkingToolContinuation && previousDecision) {
						decision = {
							...decision,
							tier: previousDecision.tier,
							targetProvider: previousDecision.targetProvider,
							targetModelId: previousDecision.targetModelId,
							targetLabel: previousDecision.targetLabel,
							thinking: previousDecision.thinking,
							reasoning:
								`Preserved ${previousDecision.targetLabel} for a Google tool-result continuation ` +
								`to avoid thought-signature replay errors. (Original: ${decision.reasoning})`,
						};
					}

					await withCommitMutex(async () => {
						state.lastDecision = decision;
					});
					actions.recordDebugDecision(decision);

					// Update status display. Wrapped in try/catch: in subagent contexts
					// the extension runtime may be invalidated (stale) after session teardown.
					try {
						if (state.lastExtensionContext) {
							actions.updateStatus(state.lastExtensionContext);
						}
					} catch {
						// Stale extension context — skip non-critical UI updates.
					}

					let modelsToTry = [
						...new Set(
							profile[decision.tier]?.models! ?? [
								formatModelRef(
									decision.targetProvider,
									decision.targetModelId,
									decision.thinking,
								),
							],
						),
					];
					// Session-scoped failure memory: chain-local (profile+tier), in-memory only
					const routeChainKey = chainKeyForRoute(model.id, decision.tier);
					const recordRouteFailure = (ref: string) => {
						const norm = normalizeFailedRef(ref);
						let s = state.failedByChain.get(routeChainKey);
						if (!s) {
							s = new Set<string>();
							state.failedByChain.set(routeChainKey, s);
						}
						s.add(norm);
					};
					const routeFailedSet = state.failedByChain.get(routeChainKey);
					let skippedDueToMemory: string[] = [];
					if (routeFailedSet && routeFailedSet.size > 0) {
						const beforeLen = modelsToTry.length;
						modelsToTry = modelsToTry.filter((ref) => {
							const norm = normalizeFailedRef(ref);
							if (routeFailedSet.has(norm)) {
								skippedDueToMemory.push(ref);
								return false;
							}
							return true;
						});
						if (modelsToTry.length === 0 && beforeLen > 0) {
							throw new Error(
								`All models in ${decision.tier} tier are marked failed this session (skipped: ${skippedDueToMemory.join(", ")}). Run /router reset-failures to retry.`,
							);
						}
					}
					let lastError: unknown;
					let success = false;

					for (let i = 0; i < modelsToTry.length; i++) {
						const modelRef = modelsToTry[i];
						const {
							provider: targetProvider,
							modelId: targetModelId,
							thinking: refThinking,
						} = parseCanonicalModelRef(modelRef);
						const tryThinking = refThinking ?? decision.thinking;

						if (targetProvider === "router") continue;

						const targetModel = registry.find(targetProvider, targetModelId);
						if (!targetModel) {
							lastError = new Error(
								`Routed model not found: ${targetProvider}/${targetModelId}`,
							);
							if (isRecordablePreStreamError(lastError))
								recordRouteFailure(modelRef);
							continue;
						}

						const auth = await registry.getApiKeyAndHeaders(targetModel);
						if (!auth.ok || !auth.apiKey) {
							lastError = new Error(
								auth.ok
									? `No API key for routed model: ${targetProvider}/${targetModelId}`
									: `Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`,
							);
							if (isRecordablePreStreamError(lastError))
								recordRouteFailure(modelRef);
							continue;
						}
						const apiKey = auth.apiKey;
						const headers = auth.headers;
						const requestModel = modelWithAuthBaseUrl(
							targetModel,
							auth as { baseUrl?: string },
						);

						if (options?.signal?.aborted) throw new Error("aborted");
						let contentReceivedForTry = false;
						let pendingCostDelta = 0;
						try {
							// HONESTY CHECK & AUTO-TRUNCATION
							// If the picked model has a smaller context than what we reported, truncate now.
							// Resolve limit per attempted model, not the original tier, so a small fallback does not overflow.
							// Note: estimateTokens uses chars/3 which underestimates CJK (≈1-1.5 tok/char); truncation may still be insufficient for heavy CJK histories.
							let effectiveContext = context;
							let targetLimit: number;
							{
								let tierForModel: RouterTier | undefined;
								for (const t of ROUTER_TIERS) {
									const tc = profile[t];
									if (!tc) continue;
									if (tc.models!.includes(modelRef)) {
										tierForModel = t;
										break;
									}
								}
								if (tierForModel) {
									targetLimit = resolveContextWindow(
										tierForModel,
										profile,
										registry,
									);
								} else {
									const found = registry.find(targetProvider, targetModelId);
									targetLimit =
										found?.contextWindow ??
										resolveContextWindow(decision.tier, profile, registry);
								}
							}
							if (targetLimit < model.contextWindow!) {
								effectiveContext = truncateContext(context, targetLimit);
							}

							const delegatedReasoning = resolveDelegatedReasoning(
								targetModel,
								tryThinking,
							) as SimpleStreamOptions["reasoning"] | undefined;

							try {
								if (state.lastExtensionContext) {
									if (delegatedReasoning) {
										state.lastExtensionContext.ui.setHiddenThinkingLabel?.(
											`Thinking (${targetProvider}/${targetModelId})...`,
										);
									} else {
										state.lastExtensionContext.ui.setHiddenThinkingLabel?.();
									}
								}
							} catch {
								// Stale extension context — skip non-critical UI updates.
							}

							// Strip pi's reasoning from options — the router controls thinking
							const { reasoning: _piReasoning, ...delegationOptions } =
								(options ?? {}) as SimpleStreamOptions;

							const delegatedStream = streamDelegated(
								registry,
								requestModel,
								effectiveContext,
								{
									...delegationOptions,
									apiKey,
									headers,
									...(delegatedReasoning
										? { reasoning: delegatedReasoning }
										: {}),
								},
							);

							// Buffer events until success to avoid pushing primary start/content before fallback succeeds (would duplicate partial assistant messages in core).
							const bufferedEvents: unknown[] = [];
							let gotDone = false;
							let gotError = false;
							let bufferedErrorMessage: string | undefined;
							if (!delegatedStream)
								throw new Error("No delegated stream available");
							for await (const event of delegatedStream) {
								if (options?.signal?.aborted) throw new Error("aborted");
								bufferedEvents.push(event);
								if ((event as { type: string }).type === "done") {
									gotDone = true;
									const cost =
										(
											event as {
												message?: { usage?: { cost?: { total?: number } } };
											}
										).message?.usage?.cost?.total ?? 0;
									pendingCostDelta = cost;
								}
								if ((event as { type: string }).type === "error") {
									gotError = true;
									const errObj = (event as { error?: unknown }).error;
									if (
										errObj &&
										typeof errObj === "object" &&
										"errorMessage" in errObj &&
										typeof (errObj as { errorMessage?: unknown })
											.errorMessage === "string"
									) {
										bufferedErrorMessage = (errObj as { errorMessage: string })
											.errorMessage;
									}
								}
								const isContent =
									(event as { type: string }).type === "text_delta" ||
									(event as { type: string }).type === "thinking_delta" ||
									(event as { type: string }).type === "toolcall_delta" ||
									(event as { type: string }).type === "toolcall_end";
								if (isContent) contentReceivedForTry = true;
							}
							if (gotDone) {
								for (const ev of bufferedEvents) stream.push(ev as never);
								success = true;
								if (pendingCostDelta) {
									await withCommitMutex(async () => {
										state.accumulatedCost += pendingCostDelta;
									});
								}
								if (i > 0) {
									const {
										provider: fp,
										modelId: fid,
										thinking: ft,
									} = parseCanonicalModelRef(modelRef);
									decision.isFallback = true;
									decision.targetProvider = fp;
									decision.targetModelId = fid;
									decision.targetLabel = formatModelRef(fp, fid);
									decision.thinking = ft ?? decision.thinking;
									await withCommitMutex(async () => {
										if (
											state.lastDecision === decision ||
											state.lastDecision?.profile === decision.profile
										) {
											state.lastDecision = { ...decision };
										}
									});
									actions.recordDebugDecision(decision);
								}
								break;
							}
							if (gotError) {
								if (contentReceivedForTry) {
									for (const ev of bufferedEvents) stream.push(ev as never);
									throw new Error(
										`NON_RETRYABLE: ${bufferedErrorMessage || "Model failed after sending content."}`,
									);
								}
								throw new Error(
									bufferedErrorMessage ||
										"Model failed before sending content.",
								);
							}
							throw new Error("Model stream ended without terminal event.");
						} catch (err) {
							if (
								err instanceof Error &&
								err.message.startsWith("NON_RETRYABLE:")
							) {
								lastError = new Error(
									err.message.slice("NON_RETRYABLE: ".length),
								);
								break;
							}
							if (contentReceivedForTry) {
								lastError = err;
								break;
							}
							lastError = err;
							if (isRecordablePreStreamError(err)) recordRouteFailure(modelRef);
						}
					}

					if (!success) {
						throw lastError instanceof Error
							? lastError
							: new Error(
									typeof lastError === "string"
										? lastError
										: "Failed to delegate to any model in the chain.",
								);
					}

					stream.end();
				} catch (error) {
					const isAborted =
						error instanceof Error && error.message === "aborted";
					if (isAborted) {
						stream.push({
							type: "done",
							reason: "stop",
							message: createErrorMessage(model, "aborted"),
						});
						stream.end();
						return;
					}
					// When a subagent session is torn down (e.g. by pi-dynamic-workflows),
					// the extension runtime is invalidated and any pi/ctx call throws a
					// stale-context error. Push a graceful done event so the stream's
					// result() promise resolves (required by AssistantMessageEventStream).
					const isStaleCtx =
						error instanceof Error && error.message.includes("stale");
					if (isStaleCtx) {
						stream.push({
							type: "done",
							reason: "stop",
							message: createErrorMessage(model, ""),
						});
					} else {
						stream.push({
							type: "error",
							reason: "error",
							error: createErrorMessage(
								model,
								error instanceof Error ? error.message : String(error),
							),
						});
					}
					stream.end();
				} finally {
					try {
						actions.persistState();
					} catch {
						// Ignore: extension context may be stale after session teardown.
					}
				}
			})();

			return stream;
		},
	});

	state.lastRegisteredModels = modelsKey;
};
