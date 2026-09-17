# pi-model-router

Smart per-turn model router extension for the [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) that optimizes your AI usage without sacrificing quality by dynamically routing each turn to the optimal LLM tier. It automatically selects between `max`, `xhigh`, `high`, `medium`, `low`, and `minimal`-tier models based on task intent, classifier, and manual effort — complete with automatic fallbacks.

## What it does

- **Logical Router Provider**: Registers a `router` provider that exposes stable routers (e.g., `router/balanced`) as models.
- **Per-Turn Routing**: Intelligently chooses between `max` / `xhigh` / `high` / `medium` / `low` / `minimal` tiers for every turn based on task intent and complexity.
- **Classifier-Based Routing**: Auto classifier maps to `minimal` / `low` / `medium` / `high` / `xhigh` / `max` (or `off` → classifier). Manual effort selects any tier directly.
- **Manual Effort Override**: `minimal` / `low` / `medium` / `high` / `xhigh` / `max` thinking levels map directly to tiers; missing tier falls back to nearest available.
- **Advanced Controls**: Includes built-in support for:
  - **LLM Intent Classifier**: Optionally use a fast model to categorize intent.
  - **TypeSafe Classifier**: Alternatively classify intent with the [TypeSafe System One API](https://docs.typesafe.ai/api) (`"classifierModels": ["@@typesafe/jev-latest"]`), gated by calibrated confidence.
  - **Fallback Chains**: Automatic retry with alternative models if the primary choice fails.
- **Effort Control**: Per-tier `effort` is forced onto all models of the tier (including model-level `#effort` and delegated models); delegated reasoning is clamped per target model.
- **Router Delegation**: Tier `models` accept `@router`, `@router#tier`, and `@router#tier#effort` entries that expand live at routing time to the target router's tier models (tier-less delegation defaults to the target's `medium` tier; delegation targets never run the classifier again).
- **Persistent State**: Routers, costs, and debug history are remembered across agent restarts and conversation branches.

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

- `~/.pi/agent/pi-model-router.json` (Global)
- `.pi/pi-model-router.json` (Project-specific)

### Basic Config Shape

```json
{
  "classifierModels": ["google/gemini-flash-latest#high"],
  "tierGuides": {
    "low": "Quick, cheap answers: one-paragraph summaries, commit messages, tiny edits.",
    "high": "Needs real design judgment: tradeoffs, planning, risky refactors in this repo."
  },
  "routers": {
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
    },
    "cheap": {
      "models": ["@grok", "openai/gpt-5.4-nano"],
      "high": { "models": ["@grok#high", "openai/gpt-5.4-pro"], "effort": "high" }
    }
  }
}
```

### Tiers & Effort Mapping

| Tier      | Auto classifier | Manual effort (`thinkingLevel`)                                    | Fallback when tier missing                               |
| --------- | --------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `minimal` | `minimal`       | `minimal`                                                          | nearest: `low` → `medium` → `high` → `xhigh` → `max`     |
| `low`     | `low`           | `low`                                                              | `medium` → `high` → `xhigh` → `max` → `minimal`          |
| `medium`  | `medium`        | `medium`                                                           | `high` → `xhigh` → `max` → `low` → `minimal`             |
| `high`    | `high`          | `high`                                                             | `xhigh` → `max` → `medium` → `low` → `minimal`           |
| `xhigh`   | `xhigh`         | `xhigh`                                                            | `max` → `high` → `medium` → `low` → `minimal`            |
| `max`     | `max`           | `max`                                                              | nearest: `xhigh` → `high` → `medium` → `low` → `minimal` |
| _(auto)_  | —               | `off` → classifier (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) | —                                                        |

### Configuration Fields

| Field                                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifierModels`                                                      | (Optional) Classifier fallback chain (array only). Auto classifier returns `minimal`/`low`/`medium`/`high`/`xhigh`/`max`. **배열만 허용**하며 항목 순서가 곧 시도/폴백 순서임(단일 문자열 형식은 없음). 항목 형식: `"provider/model#effort"`(로컬 LLM), `"@router"` / `"@router#tier"` / `"@router#tier#effort"`(해당 라우터 tier 모델을 라우팅 시점에 실시간 참조, tier 생략 시 medium), `"@@typesafe/<model>"`(TypeSafe System One, 아래 참고). 체인은 라우터 체인 → 전역 체인 → 라우터 low tier 모델 순으로 이어짐. 모두 없으면 분류기 없이 `medium` 기본 라우팅. `off` = auto. |
| `typesafeConfidenceThreshold`                                           | (Optional) 0~1 (기본 `0.5`). TypeSafe Choice 응답의 `confidence`가 이 값보다 낮으면 한 단계 위 tier로 승격함 (`max`가 상한). 자세한 동작은 [Confidence-Gated Routing](https://docs.typesafe.ai/confidence).                                                                                                                                                                                                                                                                                                                   |
| `routers`                                                              | Map of router definitions, each containing optional `max`, `xhigh`, `high`, `medium`, `low`, `minimal` tiers (at least one required). Optional router-level `models` is inherited by tiers without their own `models`.                                                                                                                                                                                                                                                                                                      |
| `routers.<name>.max` / `xhigh` / `high` / `medium` / `low` / `minimal` | Tier config: `{ "models": ["provider/model#effort", ...], "effort"?, "contextWindow"?, "maxTokens"? }`. `#effort` suffix sets delegated reasoning per model; tier-level `effort` is forced onto all tier models (overriding model-level `#` and delegation results); router-level `models` is inherited by tiers without their own `models`.                                                                                                                                                            |
| `tierGuides`                                                            | (Optional) Top-level map of tier name → classifier description (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`). Injected into the classifier system prompt in place of the built-in tier lines. Partial overrides keep built-in defaults; values are trimmed. Invalid tierGuides (non-object, unknown tier keys, non-string or empty/whitespace-only values) fail config load with an error. Hot-reloadable via `/router reload`.                                                                                             |
| `historySize`                                                           | 0–20, classifier에 전달할 직전 턴 요약 수 (기본 0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### TypeSafe Classifier (`classifierModels: ["@@typesafe/jev-latest"]`)

`classifierModels` 배열에 `"@@typesafe/<model>"` 항목을 넣으면 `thinkingLevel`이 `off`인 턴에서 그 항목 위치에서 TypeSafe System One으로 tier를 분류합니다. `<model>`은 API 요청의 `model` 필드로 **그대로** 전달되므로 API가 아는 이름을 써야 합니다(예: `jev-latest`, `jev-1.13.0`; `jev`는 400 `Unknown model`).

- **체인/폴백**: 다른 분류기 항목과 같은 체인으로 취급됩니다. 앞 항목이 실패하면 다음 항목을 시도하고, 뒤에 LLM 모델이나 low tier 폴백이 있으면 그대로 이어집니다.
  ```json
  { "classifierModels": ["@@typesafe/jev-latest", "openai/gpt-5.4-nano#low"] }
  ```
- **요청**: `state`에 `message`(최신 user 메시지)와 `history`(`historySize`만큼의 직전 user+final 결과 쌍), `questions.tier`에 `minimal`~`max` 6개 선택지(`tierGuides`가 있으면 그 설명)를 담아 `POST https://api.typesafe.ai/v1/systemone`로 보냅니다. 인증은 `Authorization: Bearer $TYPESAFE_API_KEY`입니다.
- **라우팅**: 응답의 `choice`를 tier로 쓰고, `confidence`가 `typesafeConfidenceThreshold`보다 낮으면 한 단계 위 tier로 승격합니다(불확실하면 더 강한 모델 쪽으로 기울임).
- **재시도**: 429/529/5xx는 지수 백오프로 1회 재시도하고, 그 밖의 실패는 즉시 다음 체인 항목으로 넘어갑니다. API 키가 없어도 마찬가지입니다.
- **로그**: 결과는 `~/.pi/logs/pi-model-router.log`에 `typesafe/<model>` 이름으로 기록됩니다.

```json
{
  "classifierModels": ["@@typesafe/jev-latest"],
  "typesafeConfidenceThreshold": 0.5
}
```

## Commands

| Command                   | Description                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- |
| `/router`                 | Show detailed status, current router, spend, and settings.                      |
| `/router status`          | Alias for `/router` (show current status).                                      |
| `/router debug <on\|off\|toggle\|show\|clear>` | Toggle turn-by-turn routing notifications, show or clear debug history.         |
| `/router reload`          | Hot-reload the configuration JSON.                                              |
| `/router reset-failures`  | Clear session failure memory (chain-local, in-memory).                          |
| `/router help`            | Show usage help for all subcommands.                                            |

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md): Deep dive into the routing logic and modular design.
- [Sample Configuration](docs/pi-model-router.example.jsonc): Diverse router examples (`auto`, `cheap`, `deep`, `minimal`, `effort`, `grok`, and delegation cases `refTier`/`refEffort`/`refMixed` for `@router[#tier[#effort]]` in tier `models`, `refClassifier` for `@router` `classifierModels` refs, `@@typesafe/<model>` for the TypeSafe classifier).

## Credits

Original project by [Ye Liu (yeliu84)](https://github.com/yeliu84/pi-model-router). Fork maintained by [river-gold](https://github.com/river-gold/pi-model-router).
