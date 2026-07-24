# Playwright frontend notes

Day-to-day: [AGENTS.md](../AGENTS.md) Taxonomy → Frontend.

## Fixtures

`createFountFixtures({ locale, isolated? })` — `isolated` registers `FOUNT_TEST_USERNAME` + `assertIsolatedFrontendTest` (Chat/Social/Cabinet).

API helpers in `playwright/api.mjs`: `withApiRequest`, `fetchViewerEntityHash`, `createChatTestGroup`. Prefer these over local `request.newContext` loops.

## Browser binary

`browser.mjs`: reuse PATH Chrome/Edge locally (no download). On `GITHUB_ACTIONS=true` without a system browser, `playwright install --with-deps chrome` then `channel: 'chrome'`. Launch args include `--disable-component-update` so Chrome Root Store / CRLSet updates do not swap the cert verifier mid-flight (`net::ERR_CERT_VERIFIER_CHANGED` would cancel esm.sh module loads and leave ready-gates stuck).

## Network diagnostics

`browser_diagnostics.mjs` (wired in `createFountFixtures` / `createPagesFixtures`): `response ≥ 400` / `requestfailed` → `[browser:network]` noise → imperfect wave; `pageerror`, `[test:…]` console (from `scripts/test/test_watch.mjs`), and `[i18n:missing]` (from `geti18n`, no dedup) hard-fail. `net::ERR_BLOCKED_BY_ORB` is dropped (Opaque Response Blocking; display via `<img>` etc. usually fine).

`test_watch.mjs` runs axe-core after locale gate: MutationObserver marks dirty, scans every 0.5s while dirty (or while a violation is pending confirm), stops when quiet. Playwright teardown calls `kickWatch()` via `waitForTestWatchCycle`. Hard-fail on violations except `color-contrast` and `link-in-text-block` (would force visual restyle). Structural issues (name, landmark, heading, label) still fail.

**Visibility traps**: a control with only `aria-label` and no glyph/text/`width`/`height` has a 0×0 box — Playwright `toBeVisible` reports `hidden` even when the `hidden` class is off. Icon-only clear/close buttons need a visible `×`/SVG (or explicit size).

**Scroll / infinite feed**: `infiniteScroll` is rising-edge armed — after `onLoad` the sentinel must leave then re-enter. Use Social `pumpFeedScroll` (leave past `rootMargin`, then `scrollIntoViewIfNeeded`). Prefer waiting for the cursor feed response (prefetch) before scrolling. Assert DOM outcome (count / `.feed-replay-divider`), not bare telemetry. Short first pages auto-chain-load while the sentinel stays in `rootMargin` — do not assert a hard upper bound on the initial card count.

**Double-tap**: sequential `locator.dispatchEvent('pointerup')` round-trips via CDP and often exceed a 300–350ms window under load. Prefer `dblclick()`, or fire both events inside one `page.evaluate`.

- Prefer local `page.route` over external media. Fix broken Iconify names; do not allowlist 404s.
- **Timeline seed**: same-entity post append must be **serial** in fixtures (`seedPostsViaApi`). Concurrent POSTs to one timeline drop events (signature chain race); `ensureFeedHasNextPage` loops serial seed until `nextCursor` exists.
