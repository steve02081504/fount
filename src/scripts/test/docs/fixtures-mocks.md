# Test fixture mocks

Day-to-day: [AGENTS.md](../AGENTS.md).

## ImportHandlers (ST/Risu) / easynew

Shared mock AI: `scripts/test/fixtures/mock_ai.mjs` (`seedMockAiSource`, `PROMPT_MARKER`).

- ImportHandlers: `createImportBoot` / `importAndRunChar`.
- easynew: `createEasynewBoot` / `createFromTemplate` / `runEasyChar`.
- Installed part Templates must use `fount/` imports (not `../../../../../src/…`) so they load from disposable test data dirs.

## OpenAI prompt-cache mock

`scripts/test/fixtures/openai_prompt_cache_mock.mjs` + `serviceSources/AI/proxy_openai_mock` (env `FOUNT_TEST_OPENAI_MOCK_URL`).

- Assert **exact prefix match rate** (`prefixMatchRate`).
- OpenAI `cached_tokens` still applies ≥1024 / 128 flooring in the mock response.
- Default `system_prompt_at_depth: 10` moves the system block as the log grows — expect ~83% over 100 rounds, not near-100%.

## AI prompt-prefix cache stability mocks

Shared tracker: `scripts/test/fixtures/prompt_cache_tracker.mjs` (`createPrefixCacheTracker` — per-request `grewOnly` / `commonWithFirstTokens` / `minCommonWithFirstTokens` / `allGrewOnly`). Conversation builder: `scripts/test/fixtures/ai_conversation.mjs`.

Wire-format mocks (point the generator's `base_url` at them, or use `mockJsonFetch` for hardcoded URLs):

| Provider | Mock | Integration test |
| --- | --- | --- |
| OpenAI Chat Completions (`proxy`) | `openai_prompt_cache_mock.mjs` | `serviceGenerators/AI/proxy/test/integration/prompt_prefix_stability.test.mjs` |
| Gemini (`@google/genai`) | `gemini_prompt_cache_mock.mjs` | `serviceGenerators/AI/gemini/test/integration/prompt_prefix_stability.test.mjs` |
| Anthropic Messages (`claude-api`) | `claude_prompt_cache_mock.mjs` | `serviceGenerators/AI/claude-api/test/integration/prompt_prefix_stability.test.mjs` |
| OpenAI Responses (`codex`) | `proxy/test/mockFetch.mjs` + shared tracker | `serviceGenerators/AI/codex/test/integration/prompt_prefix_stability.test.mjs` |

Each driving test sets `system_prompt_at_depth: 0` (+ `disable_default_prompt` / `roleReminding: false`) so the prompt is append-only, then asserts `allGrewOnly` and `minCommonWithFirstTokens === firstPromptTokens` across all rounds — "the same conversation always sends the same prefix". The proxy full-pipeline `prompt_cache_rate.test.mjs` (depth 10) remains the realistic moving-system case.
