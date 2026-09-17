# pi-model-router

Smart per-turn model router extension for the [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) that optimizes your AI usage without sacrificing quality by dynamically routing each turn to the optimal LLM tier. It automatically selects between `max`, `xhigh`, `high`, `medium`, `low`, and `minimal`-tier models based on task intent, classifier, and manual effort — complete with automatic fallbacks.

## What it does

- **Logical Router Provider**: Registers a `router` provider that exposes stable profiles (e.g., `router/balanced`) as models.
- **Per-Turn Routing**: Intelligently chooses between `max` / `xhigh` / `high` / `medium` / `low` / `minimal` tiers for every turn based on task intent and complexity.
- **Classifier-Based Routing**: Auto classifier maps to `minimal` / `low` / `medium` / `high` / `xhigh` / `max` (or `off` → classifier). Manual effort selects any tier directly.
- **Manual Effort Override**: `minimal` / `low` / `medium` / `high` / `xhigh` / `max` thinking levels map directly to tiers; missing tier falls back to nearest available.
- **Advanced Controls**: Includes built-in support for:
  - **LLM Intent Classifier**: Optionally use a fast model to categorize intent.
  - **TypeSafe Classifier**: Alternatively classify intent with the [TypeSafe System One API](https://docs.typesafe.ai/api) (`"classifierModels": "TYPESAFE_CLASSIFIER"`), gated by calibrated confidence.
  - **Fallback Chains**: Automatic retry with alternative models if the primary choice fails.
- **Thinking Control**: Per-tier `thinking` from `pi-model-router.json#thinking` is applied; delegated reasoning is clamped per target model.
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

| Field                                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifierModels`                                                      | (Optional) Model(s) used to categorize intent (`provider/model#thinking`). String or array of strings. Auto classifier returns `minimal`/`low`/`medium`/`high`/`xhigh`/`max`. If omitted, defaults to `medium` or falls back to `low` tier models. `off` = auto. `"TYPESAFE_CLASSIFIER"`를 쓰면 TypeSafe System One을 분류기로 씀(아래 참고).                                                                                     |
| `typesafeConfidenceThreshold`                                           | (Optional) 0~1 (기본 `0.5`). TypeSafe Choice 응답의 `confidence`가 이 값보다 낮으면 한 단계 위 tier로 승격함 (`max`가 상한). 자세한 동작은 [Confidence-Gated Routing](https://docs.typesafe.ai/confidence).                                                                                                                                                                                                                       |
| `profiles`                                                              | Map of profile definitions, each containing optional `max`, `xhigh`, `high`, `medium`, `low`, `minimal` tiers (at least one required). Optional profile-level `models` is inherited by tiers without their own `models`.                                                                                                                                                                                                          |
| `profiles.<name>.max` / `xhigh` / `high` / `medium` / `low` / `minimal` | Tier config: `{ "models": ["provider/model#thinking", ...], "thinking"?, "effort"?, "contextWindow"?, "maxTokens"? }`. `#thinking` suffix sets delegated reasoning per model; tier-level `thinking` (alias `effort`) is the default for models without `#` (`thinking` wins if both set); profile-level `models` is inherited by tiers without their own `models`.                                                                |
| `tierGuides`                                                            | (Optional) Top-level map of tier name → classifier description (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`). Injected into the classifier system prompt in place of the built-in tier lines. Partial overrides keep built-in defaults; values are trimmed. Invalid tierGuides (non-object, unknown tier keys, non-string or empty/whitespace-only values) fail config load with an error. Hot-reloadable via `/router reload`. |
| `historySize`                                                           | 0–20, classifier에 전달할 직전 턴 요약 수 (기본 0).                                                                                                                                                                                                                                                                                                                                                                               |

### TypeSafe Classifier (`classifierModels: "TYPESAFE_CLASSIFIER"`)

`classifierModels`에 `"TYPESAFE_CLASSIFIER"` 문자열을 쓰면 `thinkingLevel`이 `off`인 턴에서 로컬 LLM 분류기 대신 TypeSafe System One으로 tier를 분류합니다. 전역과 프로필 양쪽에서 쓸 수 있고, **프로필 설정이 전역 설정보다 우선**합니다(프로필에 자기 `classifierModels`가 있으면 그 프로필은 LLM 분류기를 씀).

- **요청**: `state`에 `message`(최신 user 메시지)와 `history`(`historySize`만큼의 직전 user+final 결과 쌍), `questions.tier`에 `minimal`~`max` 6개 선택지(`tierGuides`가 있으면 그 설명)를 담아 `POST https://api.typesafe.ai/v1/systemone`로 보냅니다. 인증은 `Authorization: Bearer $TYPESAFE_API_KEY`입니다.
- **라우팅**: 응답의 `choice`를 tier로 쓰고, `confidence`가 `typesafeConfidenceThreshold`보다 낮으면 한 단계 위 tier로 승격합니다(불확실하면 더 강한 모델 쪽으로 기울임).
- **실패 시**: API 키 없음, HTTP 오류(429/529/5xx는 지수 백오프로 1회 재시도), 파싱 실패면 분류를 포기하고 기본 tier(`medium`)를 유지합니다. LLM 분류기 폴백은 사용하지 않습니다.
- **로그**: 결과는 `~/.pi/logs/pi-model-router.log`에 `typesafe/jev-latest` 모델로 기록됩니다.

```json
{
  "classifierModels": "TYPESAFE_CLASSIFIER",
  "typesafeConfidenceThreshold": 0.5
}
```

## Commands

| Command                   | Description                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- |
| `/router`                 | Show detailed status, current profile, spend, and settings.                     |
| `/router status`          | Alias for `/router` (show current status).                                      |
| `/router debug <on\|off>` | Toggle turn-by-turn routing notifications (supports `toggle`, `clear`, `show`). |
| `/router reload`          | Hot-reload the configuration JSON.                                              |
| `/router help`            | Show usage help for all subcommands.                                            |

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md): Deep dive into the routing logic and modular design.
- [Sample Configuration](docs/model-router.example.jsonc): Diverse profile examples (`cheap`, `deep`, `balanced`, `refTier` for `profile#tier` refs, `refEffort` for `profile##effort` refs, `refTierEffort` for `profile#tier##effort` refs, `refClassifier` for `classifierModels` refs).

## Credits

Original project by [Ye Liu (yeliu84)](https://github.com/yeliu84/pi-model-router). Fork maintained by [river-gold](https://github.com/river-gold/pi-model-router).
