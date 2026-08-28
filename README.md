# pi-model-router

Smart per-turn model router extension for the [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) that optimizes your AI usage without sacrificing quality by dynamically routing each turn to the optimal LLM tier. It automatically selects between high, medium, and low-tier models based on task intent, context size, and custom rules — complete with automatic fallbacks and phase awareness.

## What it does

- **Logical Router Provider**: Registers a `router` provider that exposes stable profiles (e.g., `router/balanced`) as models.
- **Per-Turn Routing**: Intelligently chooses between `high`, `medium`, and `low` tiers for every turn based on task intent and complexity.
- **Rule-Based Routing**: Routes via pinned tier, custom `rules`, or `classifierModel` — no built-in keyword heuristics.
- **Advanced Controls**: Includes built-in support for:
  - **LLM Intent Classifier**: Optionally use a fast model to categorize intent (overrides heuristics).
  - **Custom Rules**: Define keyword-based tier overrides for specific patterns (e.g., `deploy` → `high`).
  - **Fallback Chains**: Automatic retry with alternative models if the primary choice fails.
- **Thinking Control**: Fixed per-tier `thinking` from `model-router.json` (no effort UI); delegated reasoning is clamped per target model.
- **Persistent State**: Pins, profiles, costs, and debug history are remembered across agent restarts and conversation branches.

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
pi -e ./src/index.ts
```

## Configuration

Copy the example config to one of:

- `~/.pi/agent/model-router.json` (Global)
- `.pi/model-router.json` (Project-specific)

### Basic Config Shape

```json
{
  "classifierModel": "google/gemini-flash-latest",
  "profiles": {
    "auto": {
      "high": { "model": "openai/gpt-5.4-pro", "thinking": "high" },
      "medium": { "model": "google/gemini-flash-latest", "thinking": "medium" },
      "low": { "model": "openai/gpt-5.4-nano", "thinking": "low" }
    }
  }
}
```

### Configuration Fields

| Field                   | Description                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- |
| `classifierModel`       | (Optional) Model used to categorize intent. Supports model aliases. If omitted, defaults to `medium` when no `rules` or `pin` matches. |
| `rules`                 | List of custom keyword rules (e.g. `{ "matches": "deploy", "tier": "high" }`).    |
| `profiles`              | Map of profile definitions, each containing optional `high`, `medium`, and `low` tiers (at least one required). |

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
