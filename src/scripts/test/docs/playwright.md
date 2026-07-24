# Playwright frontend notes

Day-to-day: [AGENTS.md](../AGENTS.md) Taxonomy → Frontend.

## Fixtures

`createFountFixtures({ locale, isolated? })` — `isolated` registers `FOUNT_TEST_USERNAME` + `assertIsolatedFrontendTest` (Chat/Social/Cabinet).

API helpers in `playwright/api.mjs`: `withApiRequest`, `fetchViewerEntityHash`, `createChatTestGroup`. Prefer these over local `request.newContext` loops.

## Browser binary

`browser.mjs`: reuse PATH Chrome/Edge locally (no download). On `GITHUB_ACTIONS=true` without a system browser, `playwright install --with-deps chrome` then `channel: 'chrome'`.

## Network diagnostics

`browser_diagnostics.mjs` (wired in `createFountFixtures` / `createPagesFixtures`): `response ≥ 400` / `requestfailed` → `[browser:network]` noise → imperfect wave; `pageerror`, `[test:…]` console (from `scripts/test/test_watch.mjs`), and `[i18n:missing]` (from `geti18n`, no dedup) hard-fail. `net::ERR_BLOCKED_BY_ORB` is dropped (Opaque Response Blocking; display via `<img>` etc. usually fine).

`test_watch.mjs` runs axe-core after locale gate: MutationObserver marks dirty, scans every 0.5s while dirty (or while a violation is pending confirm), stops when quiet. Playwright teardown calls `kickWatch()` via `waitForTestWatchCycle`. Hard-fail on violations except `color-contrast` and `link-in-text-block` (would force visual restyle). Structural issues (name, landmark, heading, label) still fail.

**Visibility traps**: a control with only `aria-label` and no glyph/text/`width`/`height` has a 0×0 box — Playwright `toBeVisible` reports `hidden` even when the `hidden` class is off. Icon-only clear/close buttons need a visible `×`/SVG (or explicit size).

**Double-tap**: sequential `locator.dispatchEvent('pointerup')` round-trips via CDP and often exceed a 300–350ms window under load. Prefer `dblclick()`, or fire both events inside one `page.evaluate`.

Prefer local `page.route` over external media. Fix broken Iconify names; do not allowlist 404s.
