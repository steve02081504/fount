# Playwright frontend notes

Day-to-day: [AGENTS.md](../AGENTS.md) Taxonomy → Frontend.

## CLI args

`runPlaywright` / `runPlaywrightWithNode` accept `playwrightArgs` as `string | string[]`. Prefer an argv array (e.g. `process.argv.slice(2)`) so grep patterns and other values with spaces keep their token boundaries; a string is still split on whitespace for older call sites.

## Fixtures

`createFountFixtures({ locale, isolated? })` — `isolated` registers `FOUNT_TEST_USERNAME` + `assertIsolatedFrontendTest` (Chat/Social/Cabinet).

API helpers in `playwright/api.mjs`: `withApiRequest`, `fetchViewerEntityHash`, `createChatTestGroup`. Prefer these over local `request.newContext` loops.

## Browser binary

`browser.mjs`: reuse PATH Chrome/Edge locally (no download). On `GITHUB_ACTIONS=true` without a system browser, `playwright install --with-deps chrome` then `channel: 'chrome'`. Launch args include `--disable-component-update` (avoids mid-flight cert-verifier swaps that cancel esm.sh loads). Fixtures use `serviceWorkers: 'block'` so `page.route` is not bypassed by the app SW.

## CDN response cache

`cdn_cache.mjs`（`createFountFixtures` / Pages fixtures 的 `context`）：对 `esm.sh` / `api.iconify.design` / `cdn.jsdelivr.net` 的 GET/HEAD 做内存 + `data/test/cdn_cache` 磁盘复用，减轻跨用例外网 flaky。只缓存 2xx/3xx；4xx 仍走真响应（坏 Iconify 名照记噪声）。`FOUNT_TEST_CDN_CACHE=0` 关闭。CDN 上可用 `route.fetch`；对本机同 URL 禁止（见 Social EVFS stub）。

## Network diagnostics

`browser_diagnostics.mjs` (wired in `createFountFixtures` / `createPagesFixtures`): `response ≥ 400` / `requestfailed` → `[browser:network]` noise → imperfect wave; `pageerror`, `[test:…]` console (from `scripts/test/test_watch.mjs`), and `[i18n:missing]` (from `geti18n`, no dedup) hard-fail. `net::ERR_BLOCKED_BY_ORB` is dropped (Opaque Response Blocking; display via `<img>` etc. usually fine). Pages fixtures ignore `/api/ping` and `:8930` installer probes only (no fount node). Locale load goes through i18n `loadLocaleData` / `setLanguage` (Pages static JSON; fount API) — do not fetch `/api/getlocaledata` from test code. `pages_server.close` calls `closeAllConnections()` before `close()` — otherwise keep-alive sockets can hang the driver past the idle watchdog.

`test_watch.mjs` after locale gate: (1) axe-core — MutationObserver marks dirty on **real** app DOM changes, scans every 0.5s while dirty, stops when quiet, reports on first hit (no confirm buffer — transitional UI must stay a11y-safe via `aria-hidden`/`inert`/`hidden` and atomic text updates); locale rotation / `pageText()` hide of `[user-content]` are wrapped in `withIgnoredMutations` so they do **not** keep the a11y timer alive; (2) locale rotation — every 1s cycles `zh-CN` → `ja-JP` → `en-UK` (skip when `fount.test.localeHold > 0`), scanning `document.title` + `body.innerText` (hiding `[user-content]` — mark user/dynamic text & inputs like `svg-inliner-ignore`) with `\p{Script=Han|Hiragana|Katakana}` (en: no CJK/kana; zh: no kana; ja: Han chars that appear in zh-CN bundle but not ja-JP — Unicode has no `\p{Hans}`). Playwright teardown calls `cycleLocales()` via `waitForLocaleCycle` (per-locale script check + one immediate a11y scan). Hard-fail on `[test:a11y]` / `[test:locale]` except axe `color-contrast` and `link-in-text-block`. Prefer `[data-i18n="…"]` selectors over locale-specific visible text. UI chrome must use `data-i18n` / `setLocalizeLogic` so locale rotation does not leave stale `geti18n()` strings.

**Visibility traps**: a control with only `aria-label` and no glyph/text/`width`/`height` has a 0×0 box — Playwright `toBeVisible` reports `hidden` even when the `hidden` class is off. Icon-only clear/close buttons need a visible `×`/SVG (or explicit size).

**Scroll / infinite feed**: `infiniteScroll` is rising-edge armed — after `onLoad` the sentinel must leave then re-enter. Use Social `pumpFeedScroll` (leave past `rootMargin`, then `scrollIntoViewIfNeeded`). Match feed API by exact pathname (`/api/parts/shells:social/feed`) — `includes('/feed')` also hits `feed.mjs`. Prefer the first no-cursor feed JSON as the page-size baseline before asserting growth (DOM may already auto-chain past that). Assert DOM outcome (count / `.feed-replay-divider`), not bare telemetry. Shrink page size with `page.route` + `route.continue({ url })` rewriting `limit`; register the route before the first `openHome` (put pagination specs in a describe without a prior open).

**Double-tap**: sequential `locator.dispatchEvent('pointerup')` round-trips via CDP and often exceed a 300–350ms window under load. Prefer `dblclick()`, or fire both events inside one `page.evaluate`.

- Prefer local `page.route` over external media. Fix broken Iconify names; do not allowlist 404s. Social fixtures stub missing EVFS media via pathname predicate (`/files/profile/avatar`, `/files/shells/social/attachments/*`): fulfill GET/HEAD with a 1×1 PNG, `continue` other methods (PUT uploads). Register on both `context` and `page`. Do **not** `route.fetch` / `page.request.fetch` that URL inside the handler. Real short-video bytes use `/__fount_test__/tiny.mp4`. Fullscreen `#videosView` intercepts side-nav clicks — leave via `#videosViewBackButton` or empty-state compose.
- **Timeline seed**: same-entity post append must be **serial** in fixtures (`seedPostsViaApi`). Concurrent POSTs to one timeline drop events (signature chain race); `ensureFeedHasNextPage` loops serial seed until `nextCursor` exists.
