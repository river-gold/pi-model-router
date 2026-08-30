# Pi Model Router: Core Mandates

## Project Overview
The `pi-model-router` is an extension-first model router for the `pi` coding agent. It registers a custom logical provider (`router`) that exposes "profiles" as models (e.g., `router/auto`). For every turn, the router intelligently selects an underlying concrete model based on task complexity, conversation phase, and user-defined rules.

## Architectural Principles
- **Extension-First**: All functionality must be implemented as a `pi` extension without modifying `pi` core.
- **Custom Provider**: Use `pi.registerProvider` to hook into the model lifecycle. The logical model (e.g., `router/auto`) should remain stable while the underlying model changes transparently.
- **Modularized Design**: Strictly follow the modular structure defined in Phase 3:
  - `src/types.ts`: All interfaces and type definitions.
  - `src/config.ts`: Configuration loading, normalization, and merging.
  - `src/routing.ts`: Core routing logic (heuristics, classifier, rule matching).
  - `src/provider.ts`: Custom `router` provider registration and delegation stream.
  - `src/state.ts`: Session-persisted state management and snapshotting.
  - `src/ui.ts`: UI status line rendering logic.
  - `src/commands.ts`: CLI command registrations and completions.
  - `index.ts`: Main entry point (orchestrator).

## Routing Decision Logic
Routing follows a tiered system (`high`, `medium`, `low`) and an ordered decision flow:
1. **LLM Classifier (Optional)**: Call `classifierModel` for intent categorization.
2. **Default**: If no classifier is configured or it fails, defaults to `medium` tier.

Note: Custom rules / heuristics / phase bias are not currently implemented; routing is intentionally simplified to classifier → medium fallback.

## Coding Standards
- **TypeScript**: Strictly adhere to TypeScript. NEVER use the `any` type; prefer specific types or `unknown`.
- **Functions**: Always use arrow functions (`const myFunc = () => ...`) instead of function statements (`function myFunc() ...`) for consistency and lexical scoping.
- **Imports**: Use top-level static imports over inline `import()` or `require()` calls for consistency and cleaner ESM code.
- **State Management**: Persist router state via `pi.appendEntry` with a custom `router-state` entry type to ensure branch-safe behavior.
- **Error Handling**: Implement robust fallback chains for model failures (retrying with alternative models).

## Documentation Reference
- `docs/ARCHITECTURE.md`: Detailed architectural deep dive.
- `README.md`: Usage and installation guide.
- `model-router.example.json`: Reference for configuration structure.
