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

| Field                                                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifierModels`                                                     | (Optional) Classifier fallback chain (array only). Auto classifier returns `minimal`/`low`/`medium`/`high`/`xhigh`/`max`. **배열만 허용**하며 항목 순서가 곧 시도/폴백 순서임(단일 문자열 형식은 없음). 항목 형식: `"provider/model#effort"`(로컬 LLM), `"@router"` / `"@router#tier"` / `"@router#tier#effort"`(해당 라우터 tier 모델을 라우팅 시점에 실시간 참조, tier 생략 시 medium), `"@@typesafe/<model>"`(TypeSafe System One, 아래 참고), `"@@agy/<model>[:<effort>]"`(agy CLI 분류, 아래 참고). 체인은 라우터 체인 → 전역 체인 → 라우터 low tier 모델 순으로 이어짐. 모두 없으면 분류기 없이 `medium` 기본 라우팅. `off` = auto. |
| `typesafeConfidenceThreshold`                                          | (Optional) 0~1 (기본 `0.5`). TypeSafe Choice 응답의 `confidence`가 이 값보다 낮으면 한 단계 위 tier로 승격함 (`max`가 상한). 자세한 동작은 [Confidence-Gated Routing](https://docs.typesafe.ai/confidence).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `routers`                                                              | Map of router definitions, each containing optional `max`, `xhigh`, `high`, `medium`, `low`, `minimal` tiers (at least one required). Optional router-level `models` is inherited by tiers without their own `models`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `routers.<name>.max` / `xhigh` / `high` / `medium` / `low` / `minimal` | Tier config: `{ "models": ["provider/model#effort", ...], "effort"?, "contextWindow"?, "maxTokens"? }`. `#effort` suffix sets delegated reasoning per model; tier-level `effort` is forced onto all tier models (overriding model-level `#` and delegation results); router-level `models` is inherited by tiers without their own `models`.                                                                                                                                                                                                                                                                                              |
| `tierGuides`                                                           | (Optional) Top-level map of tier name → classifier description (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`). Injected into the classifier system prompt in place of the built-in tier lines. Partial overrides keep built-in defaults; values are trimmed. Invalid tierGuides (non-object, unknown tier keys, non-string or empty/whitespace-only values) fail config load with an error. Hot-reloadable via `/router reload`.                                                                                                                                                                                                         |
| `historySize`                                                          | 0–20, classifier에 전달할 직전 턴 요약 수 (기본 0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `routeEveryTurn`                                                       | (Optional, 기본 `false`). `true`면 툴 루프의 매 LLM 호출마다 분류기를 다시 실행해 tier를 재결정함. 분류기 입력에 이번 턴의 최신 assistant/tool 진행상황(최대 4,000자)이 포함되어 mid-task 상향/하향이 가능함. thinking level이 `off`가 아니거나 단일 tier 라우터에서는 무시되고, 분류 실패 시 직전 tier를 유지함. `/router reload`로 핫리로드 가능.                                                                                                                                                                                                                                                                                       |

### TypeSafe Classifier (`classifierModels: ["@@typesafe/jev-latest"]`)

`classifierModels` 배열에 `"@@typesafe/<model>"` 항목을 넣으면 `thinkingLevel`이 `off`인 턴에서 그 항목 위치에서 TypeSafe System One으로 tier를 분류합니다. `<model>`은 API 요청의 `model` 필드로 **그대로** 전달되므로 API가 아는 이름을 써야 합니다(예: `jev-latest`, `jev-1.13.0`; `jev`는 400 `Unknown model`).

- **체인/폴백**: 다른 분류기 항목과 같은 체인으로 취급됩니다. 앞 항목이 실패하면 다음 항목을 시도하고, 뒤에 LLM 모델이나 low tier 폴백이 있으면 그대로 이어집니다.
  ```json
  { "classifierModels": ["@@typesafe/jev-latest", "openai/gpt-5.4-nano#low"] }
  ```
- **요청**: `state`에 `message`(최신 user 메시지)와 `history`(`historySize`만큼의 직전 user+final 결과 쌍), `questions.tier`에 `minimal`~`max` 6개 선택지(`tierGuides`가 있으면 그 설명)를 담아 `POST https://api.typesafe.ai/v1/systemone`로 보냅니다. 인증은 `Authorization: Bearer $TYPESAFE_API_KEY`입니다.
- **라우팅**: 응답의 `choice`를 tier로 쓰고, `confidence`가 `typesafeConfidenceThreshold`보다 낮으면 한 단계 위 tier로 승격합니다(불확실하면 더 강한 모델 쪽으로 기울임).
- **재시도**: 429/529/5xx는 지수 백오프로 1회 재시도하고, 그 밖의 실패는 즉시 다음 체인 항목으로 넘어갑니다. API 키가 없어도 마찬가지입니다.
- **state 크기 상한**: Jev는 state + 가장 긴 질문이 32,000 토큰(or state + 모든 질문 64,000 토큰)을 넘으면 400 `max_tokens_exceeded`를 반환합니다. `history`는 pair별 2,000자, 전체 8,000자로 잘라 보내고(잘린 경우 앞에 `…`), 초과분은 버립니다.
- **로그**: 결과는 `~/.pi/logs/pi-model-router.log`에 `typesafe/<model>` 이름으로 기록됩니다.

```json
{
  "classifierModels": ["@@typesafe/jev-latest"],
  "typesafeConfidenceThreshold": 0.5
}
```

### agy Classifier (`classifierModels: ["@@agy/gemini-3.7-flash:high"]`)

`classifierModels` 배열에 `"@@agy/<model>[:<effort>]"` 항목을 넣으면 그 항목 위치에서 agy(Google Antigravity CLI)로 tier를 분류합니다. [pi-agent-bridge](https://github.com/river-gold/pi-agent-bridge)와 동일한 spawn/턴 계약(stream-json)으로 실행됩니다.

- **항목 형식**: `@@agy/<model>` 또는 `@@agy/<model>:<effort>`. `<effort>`는 agy 모델 variant(`high`/`medium`/`low`)로 매핑됩니다. effort를 생략하면 모델 기본 variant를 씁니다.
- **variant 해석**: 모델 카탈로그는 pi-agent-bridge가 `agy models`로 저장한 캐시(`~/.cache/pi-agent-bridge/models.json`)를 참고합니다. 캐시에 있고 effort가 variant 목록에 있으면 `--model <model>-<effort>`(브리지와 동일), 캐시가 없으면 모델 id 그대로 + `--effort <effort>` 플래그로 전달합니다. effort가 variant 목록에 없으면 실패 처리되어 체인의 다음 항목으로 폴백합니다.
- **풀링**: `(model, effort)` 조합별로 long-lived agy 프로세스 1개를 재사용하고, 턴마다 전체 분류 프롬프트(LLM 체인과 동일, `tierGuides` 포함)를 stream-json 1줄로 보내 `result` 이벤트로 턴을 확정합니다. 프로세스는 idle 축출 시간(기본 30분, `AGY_CLASSIFIER_IDLE_MS`) 후 폐기되고, 다음 분류에서 새로 띄웁니다. 프로세스 수 상한은 20(`AGY_CLASSIFIER_MAX_ENTRIES`)이고, `cwd`/인자가 바뀌면 교체합니다. `pi` 종료 시 풀의 모든 프로세스를 종료합니다.
- **구조화 출력**: `--json-schema`로 `{"tier":"minimal|low|medium|high|xhigh|max"}` 출력을 강제하고, JSON 파싱이 안 되면 텍스트에서 tier 단어를 스캔하는 폴백을 씁니다.
- **환경변수**: `AGY_BINARY`(기본 `agy`), `AGY_TIMEOUT_MS`(턴 1개 타임아웃, 기본 300000), `AGY_CLASSIFIER_IDLE_MS`(풀 idle 축출, 기본 1800000 = 30분), `AGY_CLASSIFIER_MAX_ENTRIES`(기본 20), `AGY_EXTRA_ARGS`(공백 구분 추가 인자).
- **체인/폴백**: 다른 분류기 항목과 같은 체인으로 취급됩니다. 앞 항목이 실패하면 다음 항목을 시도합니다.
- **로그**: 결과는 `~/.pi/logs/pi-model-router.log`에 `agy/<model>` 이름으로 기록됩니다.

```json
{
  "classifierModels": ["@@agy/gemini-3.7-flash:high", "openai/gpt-5.4-nano#low"]
}
```

## Commands

| Command                                        | Description                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `/router`                                      | Show detailed status, current router, spend, and settings.              |
| `/router status`                               | Alias for `/router` (show current status).                              |
| `/router debug <on\|off\|toggle\|show\|clear>` | Toggle turn-by-turn routing notifications, show or clear debug history. |
| `/router reload`                               | Hot-reload the configuration JSON.                                      |
| `/router reset-failures`                       | Clear session failure memory (chain-local, in-memory).                  |
| `/router help`                                 | Show usage help for all subcommands.                                    |

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md): Deep dive into the routing logic and modular design.
- [Sample Configuration](docs/pi-model-router.example.jsonc): Diverse router examples (`auto`, `cheap`, `deep`, `minimal`, `effort`, `grok`, and delegation cases `refTier`/`refEffort`/`refMixed` for `@router[#tier[#effort]]` in tier `models`, `refClassifier` for `@router` `classifierModels` refs, `@@typesafe/<model>` for the TypeSafe classifier).

## Credits

Original project by [Ye Liu (yeliu84)](https://github.com/yeliu84/pi-model-router). Fork maintained by [river-gold](https://github.com/river-gold/pi-model-router).
