---
description: AI service generators — OAuth subscriptions, IAM clouds, Responses vs proxy. Pull when adding an AI generator or changing login/credential flow.
globs: src/public/parts/serviceGenerators/AI/**
alwaysApply: false
---

# AI generators

OpenAI-compatible **API keys** (DeepSeek, OpenRouter, Groq, Azure Chat Completions, …) stay on [proxy](proxy/). Do not grow proxy to cover OAuth, Bedrock Converse, Vertex ADC, or Responses.

**AI-source identity**: `buildSourceInfo` ([proxy/src/sourceInfo.mjs](proxy/src/sourceInfo.mjs)) sets each locale's `info.name = config.model || config.name` (model name wins) and, only when the generator's API URL is overridden from its template, `info.provider = hostname(url)`; there is no separate `info.model`. Generators with an overridable URL pass `{ url, defaultUrl }` (shared factories take a `providerUrl` arg). Chars read it via `getPartInfo(source, locales)` to tell the model what it is.

Overly generic helpers live in the representative part; callers import from there. Provider-specific URL/route/UI stays in that generator.

**AI-source context / token counting**: every source exposes an optional `context_size` number (max input tokens) on its `AIsource_t`; wrappers/aggregators take the min of their members ([identityTokenizer.mjs](proxy/src/identityTokenizer.mjs) `minKnownContextSize`). Token counting goes through `Tokenizer_t.get_token_count`; when a provider has no real tokenizer (or the API call fails) fall back to `estimateTokenCount` — ASCII ≈ 4 chars/token, ideographic / syllabic scripts (CJK, kana, hangul, bopomofo, fullwidth, emoji) ≈ 1 char/token, other non-ASCII letter scripts ≈ 2 chars/token; aligned with opencode's `length / 4` but script-aware. Proxy auto-fills `config.context_size` from models.dev `limit.input ?? limit.context` when a model is picked in its view (models.dev has no tokenizer field, so counter is the shared estimator).

**`convert_config` file policy**: `ignoreFiles` / `forbidSystemFiles` / `forbidAssistantFiles` are MIME regex lists (legacy `ignoreFiles: true` = `['.*']`); `ignoreFiles` hits drop the attachment into a system notice, `forbidSystemFiles` hits downgrade a system message to `user` prefixed `system: `, `forbidAssistantFiles` hits downgrade an assistant (char) message to `user` prefixed `assistant: ` (default empty; configure for sources like Kimi that reject attachments on assistant messages). `messageBuilder.mjs` statically `import`s `src/decl/*.ts` types for JSDoc, so its policy logic lives in the decl-free [proxy/src/messagePolicies.mjs](proxy/src/messagePolicies.mjs) — `pure/` tests cover it there without pulling the decl graph. (`deno.json` sets `strictPropertyInitialization: false` because the JSDoc-style decl classes declare uninitialized fields.)

| Need | Home |
| --- | --- |
| OpenAI-compat source / `convert_config` / token estimator / `buildSourceInfo` | [proxy/src](proxy/src/) (`createOpenAICompatibleSource`, `defaultConvertConfig`, `identityTokenizer` + `estimateTokenCount` / `minKnownContextSize`, `sourceInfo`) |
| Responses client + source | [codex/src](codex/src/) (`createResponsesSource`); Azure imports it |
| OAuth login UI | [oauth_handler](../../shells/oauth_handler/AGENTS.md) `public/src/oauthDisplay.mjs`; each OAuth generator’s `display.mjs` calls `renderOauthPanel` |
| Fetch doubles | [proxy/test/mockFetch.mjs](proxy/test/mockFetch.mjs) |

## OAuth (Codex / Claude Pro-Max / GitHub Copilot)

Login completion is **only** [oauth_handler](../../shells/oauth_handler/AGENTS.md):

- Canonical page: `/parts/shells:oauth_handler/callback`
- GitHub Pages bounce: `https://steve02081504.github.io/fount/oauth/callback` — only when that HTTPS `redirect_uri` is registered on the OAuth app. Piggybacked Codex/Claude client IDs cannot use it.
- Hardcoded localhost hooks: Codex `http://localhost:1455/auth/callback`, Claude `http://localhost:53692/callback`. Bind, **302 to canonical**. Do not exchange tokens on those ports.
- Copilot is device flow (no port).
- Runtime refresh: `ensureOAuthCredentials` in the oauth_handler shell. Persist to `config.oauth`.

Claude third-party traffic is **extra usage**, not plan quota. Do not send Claude Code billing spoof headers (`x-anthropic-billing-header` / `cc_entrypoint=sdk-cli`). Codex `originator` is `fount`.

## IAM / cloud

Credentials come from the user’s environment or JSON fields — no invented fallbacks:

| Generator | Auth |
| --- | --- |
| `bedrock` | AWS default chain (`AWS_PROFILE` / keys / `AWS_BEARER_TOKEN_BEDROCK` / ECS / IRSA) + `region` |
| `vertex` | ADC (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`) + `project` / `location`. Separate from the `gemini` API-key generator. |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` + endpoint; `/openai/v1/responses` with `api-key` |
| `cloudflare-workers-ai` | account id + API token; OpenAI-compat + `x-session-affinity` |
| `cloudflare-ai-gateway` | account + gateway + `cf-aig-authorization`; route `openai/` / `anthropic/` / compat by model prefix |

`claude-api` / `gemini` export `GetSource` extras (`getClient` / `createAi`) so OAuth and Vertex do not copy the call layer.

Tests: `fount test serviceGenerators/AI/<name>` and `fount test shells/oauth_handler`.
