---
description: oauth_handler shell — canonical AI OAuth callback, Pages bounce, localhost port hooks. Pull when changing login/callback/token exchange.
globs: src/public/parts/shells/oauth_handler/**
alwaysApply: false
---

# oauth_handler

Canonical OAuth completion for fount AI subscription logins.

- Callback page: `/parts/shells:oauth_handler/callback`
- REST: `/api/parts/shells:oauth_handler/{start,complete,status/:state,cancel}`
- PKCE providers bind the upstream-registered localhost port and 302 here (`1455/auth/callback` Codex, `53692/callback` Claude). Device flow (GitHub Copilot) does not bind a port.
- GitHub Pages bounce (`.github/pages/oauth/callback`) only runs when the OAuth app registered that HTTPS `redirect_uri`. Piggybacked Codex/Claude client IDs cannot.
- Token exchange stays on the server. Persist to `serviceSources/AI/<name>/config.oauth` when `sourceName` is supplied.
- Generators refresh via `ensureOAuthCredentials` in `src/providers.mjs`. Claude third-party traffic is extra usage; do not spoof Claude Code billing headers.
- Config UI: `public/src/oauthDisplay.mjs` exports `renderOauthPanel`. OAuth generators’ `display.mjs` import it and pass their provider id.
