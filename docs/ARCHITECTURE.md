# Architecture: Pi Model Router Extension

The `pi-model-router` extension registers each configured router as a pi [virtual model](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md) named `router/<name>` via `pi.registerVirtualModel`. Pi selects the virtual model; the router's `route()` picks the physical model and thinking level for each request, and pi performs the dispatch, records the physical model, restores the selection with the session, and compacts against the routed model.

## Routing

A router has one or more of seven tiers: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. The current pi thinking level selects the corresponding tier. If it is not configured, the router uses the nearest available tier; `off` falls back in order from `minimal` to `max`. A router with only one resolvable tier uses that tier.

Tier model lists support `@router`, `@router#tier`, and `@router#tier#effort` references. References are expanded at request time with cycle detection. A reference without a tier follows the tier being resolved, so `@hyper` in a `high` tier resolves to `hyper`'s `high` tier. A tier's `effort` overrides the model-level `#effort` on its direct models, but is not propagated through delegation; the referenced router's own tier effort applies.

For a continuation request pi passes the physical model that answered the turn; the router returns it unchanged to preserve the tool loop and the prompt cache. On a retry the router excludes the failed model and picks the next candidate. Candidates without a physical model or without credentials are skipped.

By default models are attempted in configuration order. With a router's `random` option enabled, an eligible model is chosen randomly for each session and resolved tier, stored as router state, and reused across requests. Router state follows the session branch, so a resumed session restores the selection and a fork inherits it.

## Modules

- `src/index.ts` and `src/index/`: extension setup, session handling, commands, and configuration reload.
- `src/virtualModel.ts`: virtual model definitions, `route()`, tier/limit resolution, and registration.
- `src/routing.ts`: thinking level to tier mapping.
- `src/config/`: configuration loading, normalization, merging, references, and tier resolution.
- `src/commands.ts` and `src/ui.ts`: commands and status formatting.
- `src/state/`: extension state.
- `src/types.ts`: shared types.

## State and reliability

Router state (random selections) is stored on the session branch by pi and restored automatically. Debug history and the last routing decision live in extension memory for the session. Credential and model availability are checked before a candidate is returned, so a broken candidate is skipped without failing the turn. Automatic retries use pi's `settings.retry` policy.
