# pi-model-router

Smart per-turn model router extension for the [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) that optimizes your AI usage without sacrificing quality by dynamically routing each turn to the optimal LLM tier. It automatically selects between `max`, `xhigh`, `high`, `medium`, `low`, and `minimal`-tier models based on task intent, classifier, and manual effort — complete with automatic fallbacks.

## What it does

- **Logical Router Provider**: Registers a `router` provider that exposes stable profiles (e.g., `router/balanced`) as models.
- **Per-Turn Routing**: Intelligently chooses between `max` / `xhigh` / `high` / `medium` / `low` / `minimal` tiers for every turn based on task intent and complexity.
- **Classifier-Based Routing**: Auto classifier maps to `minimal` / `low` / `medium` / `high` / `xhigh` / `max` (or `off` → classifier). Manual effort selects any tier directly.
- **Manual Effort Override**: `minimal` / `low` / `medium` / `high` / `xhigh` / `max` thinking levels map directly to tiers; missing tier falls back to nearest available.
- **Advanced Controls**: Includes built-in support for:
  - **LLM Intent Classifier**: Optionally use a fast model to categorize intent.
  - **Fallback Chains**: Automatic retry with alternative models if the primary choice fails.
- **Thinking Control**: Per-tier `thinking` from `model-router.json#thinking` is applied; delegated reasoning is clamped per target model.
- **Persistent State**: Profiles, costs, and debug history are remembered across agent restarts and conversation branches.

## Installation

### As a user

Install from npm:

```bash
pi install npm:@river-gold/pi-model-router
```

### For development

Clone this repo and install from source:

```bash
pi install .
```

Or load directly for one run:

```bash
pi -e ./index.ts
```

## Configuration

Copy the example config to one of:

- `~/.pi/agent/model-router.json` (Global)
- `.pi/model-router.json` (Project-specific)

### Basic Config Shape

```json
{
  "classifierModels": ["google/gemini-flash-latest#high"],
  "profiles": {
    "auto": {
      "high": { "models": ["openai/gpt-5.4-pro#high"] },
      "medium": { "models": ["google/gemini-flash-latest#medium"] },
      "low": { "models": ["openai/gpt-5.4-nano#low"] }
    },
    "grok": {
      "classifierModels": ["xai/grok-composer-2.5"],
      "max": { "models": ["xai/grok-4.6#max"] },
      "xhigh": { "models": ["xai/grok-4.6#xhigh"] },
      "high": { "models": ["xai/grok-4.6#high"] },
      "medium": { "models": ["xai/grok-4.6#medium"] },
      "low": { "models": ["xai/grok-4.6#low"] },
      "minimal": { "models": ["xai/grok-4.6#minimal"] }
    }
  }
}
```

### Tiers & Effort Mapping

| Tier | Auto classifier | Manual effort (`thinkingLevel`) | Fallback when tier missing |
|------|-----------------|----------------------------------|----------------------------|
| `minimal` | `minimal` | `minimal` | nearest: `low` → `medium` → `high` → `xhigh` → `max` |
| `low` | `low` | `low` | `medium` → `high` → `xhigh` → `max` → `minimal` |
| `medium` | `medium` | `medium` | `high` → `xhigh` → `max` → `low` → `minimal` |
| `high` | `high` | `high` | `xhigh` → `max` → `medium` → `low` → `minimal` |
| `xhigh` | `xhigh` | `xhigh` | `max` → `high` → `medium` → `low` → `minimal` |
| `max` | `max` | `max` | nearest: `xhigh` → `high` → `medium` → `low` → `minimal` |
| _(auto)_ | — | `off` → classifier (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) | — |

### Configuration Fields

| Field | Description |
|-------|-------------|
| `classifierModels` / `classifierModel` | (Optional) Model(s) used to categorize intent (`provider/model#thinking`). Auto classifier returns `minimal`/`low`/`medium`/`high`/`xhigh`/`max`. If omitted, defaults to `medium` or falls back to `low` tier models. `off` = auto. |
| `profiles` | Map of profile definitions, each containing optional `max`, `xhigh`, `high`, `medium`, `low`, `minimal` tiers (at least one required). |
| `profiles.<name>.max` / `xhigh` / `high` / `medium` / `low` / `minimal` | Tier config: `{ "models": ["provider/model#thinking", ...], "contextWindow"?, "maxTokens"? }`. `#thinking` suffix sets delegated reasoning. |
| `historySize` | 0–20, classifier에 전달할 직전 턴 요약 수 (기본 0). |

## Commands

| Command                     | Description                                                                     |
| --------------------------- | ------------------------------------------------------------------------------- |
| `/router`                   | Show detailed status, current profile, spend, and settings.                     |
| `/router status`            | Alias for `/router` (show current status).                                      |
| `/router debug <on\|off>`   | Toggle turn-by-turn routing notifications (supports `toggle`, `clear`, `show`). |
| `/router reload`            | Hot-reload the configuration JSON.                                              |
| `/router help`              | Show usage help for all subcommands.                                            |

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md): Deep dive into the routing logic and modular design.
- [Sample Configuration](docs/model-router.example.json): Diverse profile examples (`cheap`, `deep`, `balanced`).

## Credits

Original project by [Ye Liu (yeliu84)](https://github.com/yeliu84/pi-model-router). Fork maintained by [river-gold](https://github.com/river-gold/pi-model-router).
