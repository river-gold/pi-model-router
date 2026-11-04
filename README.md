# pi-model-router

A model router extension for [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent). Each router is registered as a `router/<name>` [virtual model](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md) and routes every request to a physical model of the tier selected by the current thinking level.

## Installation

Requires pi-coding-agent 1.5.0 or later.

```bash
pi install npm:@river-gold/pi-model-router
```

For development, run `pi install .` or load once with `pi -e ./index.ts`.

## Configuration

Place JSON or JSONC configuration in `~/.pi/agent/pi-model-router.json[c]` or `.pi/pi-model-router.json[c]`. Project configuration is merged over global configuration. See [the example](docs/pi-model-router.example.jsonc).

```json
{
  "routers": {
    "balanced": {
      "off": { "models": ["openai/example-small#off"] },
      "minimal": { "models": ["openai/example-small#minimal"] },
      "medium": { "models": ["openai/example-medium#medium"] },
      "high": { "models": ["openai/example-large#high", "openai/example-backup#high"] }
    },
    "delegated": {
      "medium": { "models": ["@balanced#medium", "openai/example-backup"] }
    }
  }
}
```

Configure at least one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` per router. The thinking level selects the tier of the same name. If that tier is absent or cannot be resolved, the router searches upward first, then downward in the order `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. For example, `off` falls back to `minimal`, then `low`, and so on. During a tool loop the model that handled the turn is reused.

Each tier accepts a `models` fallback list, optional `effort`, `contextWindow`, `maxTokens`, and `reasoning`. A router-level `models` list is inherited by explicitly configured tiers that omit their own list. Model entries use `provider/model[#effort]` or a live router reference `@router[#tier[#effort]]`. A reference without a tier defaults to `medium`. Tier-level `effort` overrides the effort of direct models but does not propagate through router references; specify the reference's effort explicitly when needed.

Set `"random": true` on a router to select a model randomly per session and tier. The selected model is reused across requests and restored with the session; a session fork inherits the parent's selection.

## Routing behavior

- The thinking level selects the tier. The physical model is chosen from the tier's candidates.
- A candidate without a physical model or without credentials is skipped, so an unavailable first choice does not fail the turn.
- A retry after a transient failure excludes the failed model and picks the next candidate; pi's automatic retry policy (`settings.retry`) controls how many attempts are made.
- Context compaction and limits are handled by pi against the routed physical model.
- Assistant messages record the physical model and thinking level that answered.

Legacy classifier settings (`classifierModels`, `typesafeConfidenceThreshold`, `historySize`, `routeEveryTurn`, and `tierGuides`) are ignored. No classifier, JEV/TypeSafe API, or agy process is invoked.

## Commands

- `/router status`: show the current router and last decision.
- `/router debug <on|off|toggle|show|clear>`: control debug history.
- `/router reload`: reload configuration.
- `/router help`: show help.
