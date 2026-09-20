# Architecture: Pi Model Router Extension

The `pi-model-router` is an extension-first model router for the `pi` coding agent. It registers a custom logical provider (`router`) that exposes "routers" as models (e.g., `router/balanced`). For every turn, the router intelligently selects an underlying concrete model based on task complexity and optional classifier.

## Core Concepts

### 1. Routers & Tiers

The router is organized into **Routers** (e.g., `balanced`, `cheap`, `deep`, `grok`). Each router defines up to six **Tiers** (at least one required):

- **minimal**: Mechanical transforms with no judgment: format, typo, rename, indent, template fill, quote-from-context. Classifier `minimal` or manual `minimal`.
- **low**: Cheap language/lookup work: summaries, changelogs, commit messages, quick explanations, small bounded transforms, simple read-only lookup. Classifier `low` or manual `low`.
- **medium**: Execute a known plan: spec-following implementation, multi-file edits, focused debugging with known cause, tests/fixes, routine wiring. Classifier `medium` or manual `medium`.
- **high**: Local design under uncertainty: module architecture, planning, tradeoff analysis, broad debugging, large refactors, codebase research. Classifier `high` or manual `high`.
- **xhigh**: Cross-cutting or high-blast-radius work: migrations, ambiguous RCA, security-sensitive changes, multi-repo/system design, risky refactors. Classifier `xhigh` or manual `xhigh`.
- **max**: Novel or irreversible work: greenfield strategy, adversarial audit, long-horizon research with conflicting sources, eval/algorithm invention. Classifier `max` or manual `max`.

The built-in tier descriptions above are the classifier defaults; they can be overridden per tier via the top-level `tierGuides` config map (partial overrides keep the remaining defaults; invalid `tierGuides` fail config load with an error).

### 2. Custom Provider Implementation

The extension uses `pi.registerProvider` to hook into the `pi` model lifecycle. This ensures that the selected model in the `pi` footer remains stable (e.g., `router/balanced`) while the underlying model changes transparently turn-by-turn via the `streamSimple` interception.

## Routing Decision Flow

For every request sent to a `router/*` model, the following logic is executed:

1. **Manual Effort Override**: If `pi.getThinkingLevel() !== 'off'`, map `minimal`→`minimal`, `low`→`low`, `medium`→`medium`, `high`→`high`, `xhigh`→`xhigh`, `max`→`max`, then `resolveAvailableTier()` to nearest configured tier.
2. **Classifier**: If `thinkingLevel === 'off'`, classify the turn into a tier.
   - **TypeSafe System One** (`"@@typesafe/<model>"` entry): one `choice` question over `minimal`~`max` (`POST https://api.typesafe.ai/v1/systemone`, `model` = the entry's `<model>`). The returned `confidence` gates routing: below `typesafeConfidenceThreshold` the tier escalates one step up. A failure moves on to the next chain entry (LLM model or low tier fallback). The `state.history` sent to Jev is truncated (2,000 chars per pair, 8,000 chars total) to stay under Jev's 32,000-token state budget, which otherwise returns 400 `max_tokens_exceeded`.
   - **LLM classifier** (default): `classifierModels` entries (or the `low` tier fallback) classify to `minimal`/`low`/`medium`/`high`/`xhigh`/`max`.

   The `classifierModels` array is the fallback chain: entries are tried in order (`@router#tier` refs are expanded at routing time) until one returns a tier.

3. **Default**: If no classifier is configured or it fails, defaults to `medium` (with `resolveAvailableTier()` fallback).
4. **Delegation & Effort**: The selected tier's `models` list may contain `@router`, `@router#tier`, `@router#tier#effort` entries; these expand live (with nearest-tier fallback and cycle skipping) to the target router's tier models. A tier-level `effort` is forced onto every model of the tier, overriding model-level `#effort` and delegation results. Delegation targets never run the classifier again — tier-less delegation goes straight to the target's `medium` tier.

During a tool loop (follow-up requests whose latest message is a `toolResult`), the classifier is skipped and the turn's initial tier is preserved. With `"routeEveryTurn": true`, the classifier re-runs on every tool-loop request instead; its input includes the turn's latest assistant/tool output (up to 4,000 chars), so the tier can escalate or de-escalate mid-task. This is ignored when `thinkingLevel !== 'off'` or the router has a single tier, and classification failure keeps the previous tier.

## Module Architecture

The extension is modularized for maintainability:

- `src/index.ts` + `src/index/`: Orchestrator. Manages state, hooks into `pi` events, and wires modules together (provider/commands/handlers/persist/reload/fallback/actions).
- `src/provider.ts` + `src/provider/`: Implements the `router` provider and the delegation/retry loop (routing decision, classifier branch, delegate fallback, model/limit resolution).
- `src/routing.ts`: Core decision logic (tier resolution) and routing helpers.
- `src/config/`: Loads, merges, and normalizes the JSON configuration (normalize/tier/ref delegation expansion/classifier/tierGuides/registry/io).
- `src/classifier.ts`: LLM classifier fallback chain (tries each `classifierModels` entry, then the low tier models).
- `src/typesafe/`: TypeSafe System One classifier (request building, response parsing, confidence gating, HTTP client, orchestration) used by `"@@typesafe/<model>"` chain entries.
- `src/commands.ts`: Registers all `/router` subcommands and their autocompletions.
- `src/ui.ts`: Manages the router status line.
- `src/session/` + `src/state/`: Session-persisted state, restore, and snapshots.
- `src/failureMemory/`: Per-session, chain-local failure memory for fallback chains.
- `src/logger/`: Classifier/delegation sync logs (`~/.pi/logs/pi-model-router.log`).
- `src/context/`: Context extraction/truncation helpers.
- `src/stream.ts`: Delegated streaming helpers.
- `src/types.ts`: Centralized interface and type definitions.

## State & Persistence

The router state is persisted using `pi.appendEntry` with a custom type `router-state`. This allows the router to:

- Restore the active router across agent relaunches.
- Track accumulated session costs safely.

## Reliability: Fallback Chains

A tier's `models` array **is** the fallback chain. If the primary model fails (e.g., due to rate limits or provider downtime), the router automatically retries the next model in the list before surfacing an error to the user. Failures are remembered per session and per chain (in-memory) so repeatedly failing models are skipped for the rest of the session. Delegated `@router` entries expand to the target tier's full model list, so delegation composes with fallback automatically.
