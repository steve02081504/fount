---
description: AI service generators — OAuth subscriptions, IAM clouds, Responses vs proxy. Pull when adding an AI generator or changing login/credential flow.
globs: src/public/parts/serviceGenerators/AI/**
alwaysApply: false
---

# AI generators

OpenAI-compatible **API keys** (DeepSeek, OpenRouter, Groq, Azure Chat Completions, …) stay on [proxy](proxy/). Do not grow proxy to cover OAuth, Bedrock Converse, Vertex ADC, or Responses.

Overly generic helpers live in the representative part; callers import from there. Provider-specific URL/route/UI stays in that generator.

| Need | Home |
| --- | --- |
| OpenAI-compat source / `convert_config` / identity tokenizer | [proxy/src](proxy/src/) (`createOpenAICompatibleSource`, `defaultConvertConfig`, `identityTokenizer`) |
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
