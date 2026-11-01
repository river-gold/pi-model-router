# Architecture: Pi Model Router Extension

The `pi-model-router` extension registers a logical `router` provider with `pi.registerProvider`. Each configured router appears as a model such as `router/balanced`; its `streamSimple` implementation delegates requests to concrete provider models.

## Routing

A router has one or more of seven tiers: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. The current Pi thinking level selects the corresponding tier. If it is not configured, the router uses the nearest available tier; `off` falls back in order from `minimal` to `max`. A router with only one resolvable tier uses that tier. During a tool loop the initial tier is retained.

Tier model lists support `@router`, `@router#tier`, and `@router#tier#effort` references. References are expanded at request time with cycle detection. A tier's `effort` overrides the model-level `#effort` on its direct models, but is not propagated through delegation; a reference can specify an explicit override.

By default models are attempted in configuration order. With a router's `random` option enabled, an eligible model is chosen randomly for each session, router, and resolved tier. Subsequent requests reuse that choice. If it fails before streaming, other candidates are tried in random order and a successful fallback becomes the new choice. The chosen model reference includes its effort. Independently loaded extensions in child sessions select separately, even when their session history includes the parent's state.

## Modules

- `src/index.ts` and `src/index/`: extension setup, lifecycle handlers, commands, and persistence wiring.
- `src/provider.ts` and `src/provider/`: provider registration, model selection, delegation, and fallback.
- `src/routing.ts`: tier selection and routing decisions.
- `src/config/`: configuration loading, normalization, merging, references, and tier resolution.
- `src/commands.ts` and `src/ui.ts`: commands and status display.
- `src/session/` and `src/state/`: session state, restoration, and snapshots.
- `src/failureMemory/`: chain-local failure memory and rate-limit cooldowns.
- `src/logger/`, `src/context/`, and `src/stream.ts`: logging, context helpers, and streaming.
- `src/types.ts`: shared types.

## State and reliability

The extension persists `router-state` custom entries via `pi.appendEntry`, including the active router, costs, and random selections. Random selections are restored only when the stored session ID matches the current session. Invalid stored selection values are ignored.

The model list is also the fallback chain. Pre-stream failures can trigger the next candidate; failures remembered by the router are skipped according to their failure type. Delegated references expand to their target models before fallback selection. Failure memory is kept in memory per session and chain.
