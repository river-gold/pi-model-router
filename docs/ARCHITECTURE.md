# Architecture: Pi Model Router Extension

The `pi-model-router` is an extension-first model router for the `pi` coding agent. It registers a custom logical provider (`router`) that exposes "profiles" as models (e.g., `router/balanced`). For every turn, the router intelligently selects an underlying concrete model based on task complexity and optional classifier.

## Core Concepts

### 1. Profiles & Tiers

The router is organized into **Profiles** (e.g., `balanced`, `cheap`, `deep`). Each profile defines up to three **Tiers** (at least one required):

- **High**: Reserved for architecture, design, complex debugging, and planning. Uses high-reasoning models.
- **Medium**: The default for standard implementation, multi-file edits, and focused fixes.
- **Low**: Used for summaries, changelogs, formatting, and simple read-only lookups.

### 2. Custom Provider Implementation

The extension uses `pi.registerProvider` to hook into the `pi` model lifecycle. This ensures that the selected model in the `pi` footer remains stable (e.g., `router/balanced`) while the underlying model changes transparently turn-by-turn via the `streamSimple` interception.

## Routing Decision Flow

For every request sent to a `router/*` model, the following logic is executed:

1. **LLM Classifier (Optional)**: If `classifierModel` is configured, a fast LLM is called to categorize the user's intent.
2. **Default**: If no classifier is configured or it fails, the router defaults to `medium` tier.

## Module Architecture

The extension is modularized for maintainability:

- `index.ts`: Orchestrator. Manages state, hooks into `pi` events, and wires modules together.
- `src/provider.ts`: Implements the `router` provider and the delegation/retry loop.
- `src/routing.ts`: Core decision logic (tier resolution) and routing helpers.
- `src/config.ts`: Loads, merges, and normalizes the JSON configuration.
- `src/commands.ts`: Registers all `/router` subcommands and their autocompletions.
- `src/ui.ts`: Manages the router status line.
- `src/state.ts`: Handles session-persisted state and snapshots.
- `src/types.ts`: Centralized interface and type definitions.

## State & Persistence

The router state is persisted using `pi.appendEntry` with a custom type `router-state`. This allows the router to:

- Restore the active profile across agent relaunches.
- Track accumulated session costs safely.

## Reliability: Fallback Chains

Each tier in a profile can define an optional `fallbacks` list. If the primary model fails (e.g., due to rate limits or provider downtime), the router automatically retries the next model in the chain before surfacing an error to the user.
