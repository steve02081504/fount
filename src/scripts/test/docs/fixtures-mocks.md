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
