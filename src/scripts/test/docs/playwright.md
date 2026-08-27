# Playwright frontend notes

Day-to-day selectors / taxonomy: [AGENTS.md](../AGENTS.md). This file is fixtures, browser binary, CDN cache, network diagnostics, and page-watch traps.

## CLI args

`runPlaywright` / `runPlaywrightWithNode` accept `playwrightArgs` as `string | string[]`. Prefer an argv array (e.g. `process.argv.slice(2)`) so grep patterns and other values with spaces keep their token boundaries; a string is still split on whitespace for older call sites.

Single-config Pages driver (`.github/pages/test/frontend/run.mjs`) has no Playwright projects: it passes spec filenames from `playwrightArgsForSubtests` when `FOUNT_TEST_SUBTESTS` is set (`pages:frontend:wait` → `wait.spec.mjs`). Do not rely on argv slice alone or a named subtest still runs every `*.spec.mjs`.

## Fixtures

`createFountFixtures({ locale, isolated? })` — `isolated` registers `FOUNT_TEST_USERNAME` + `assertIsolatedFrontendTest` (Chat/Social/Cabinet). Locale `addInitScript` wraps `localStorage` in try/catch (`about:blank` / sandboxed frames throw `SecurityError`). When `FOUNT_TEST_HUB_URL` is set (parent hub `127.0.0.1:8903`), fixtures also inject `fount.test.hubUrl` for in-page hub clients / page `watch`.

API helpers in `playwright/api.mjs`: `withApiRequest`, `fetchViewerEntityHash`, `createChatTestGroup`. Prefer these over local `request.newContext` loops.

## Browser binary

`browser.mjs`: reuse PATH Chrome/Edge locally (no download). On `GITHUB_ACTIONS=true` without a system browser, `playwright install --with-deps chrome` then `channel: 'chrome'`. Launch args include `--disable-component-update` (avoids mid-flight cert-verifier swaps that cancel esm.sh loads). Fixtures use `serviceWorkers: 'block'` so `page.route` is not bypassed by the app SW.

## CDN response cache

`cdn_cache.mjs` (wired into `createFountFixtures` / Pages fixtures `context`): memory + `data/test/cdn_cache` disk reuse for GET/HEAD to `esm.sh` / `api.iconify.design` / `cdn.jsdelivr.net`, cutting cross-case network flakiness. Cache keys include method so GET and HEAD never share an entry. Cached GET fulfill headers drop `content-encoding` and set `content-length` to the plaintext body size; HEAD fulfills keep the upstream headers (empty body must not rewrite `content-length`). Requests with `Range` bypass the cache. Only 2xx/3xx are cached; 4xx stay live (bad Iconify names still count as noise). If `route.fetch` succeeds but `response.body()` throws disposed/closed (page teardown), abort the route instead of failing the test. `FOUNT_TEST_CDN_CACHE=0` disables. After bumping a browser-facing package served via unversioned `esm.sh` URLs (e.g. `@steve02081504/fount-p2p`), delete matching files under `data/test/cdn_cache` (or set `FOUNT_TEST_CDN_CACHE=0` once) so tests do not keep serving a stale transpile. `route.fetch` is fine for CDN URLs; do not fetch same-origin local URLs that way (see Social EVFS stub).

## JSON editor a11y

`json_editor.mjs` → `expectJsonEditorAriaLabel(page, containerSelector, i18nKey, expect)` asserts `vanilla-jsoneditor` text-mode `.cm-content` `aria-label` matches `geti18n(key)`. Product wrappers must pass an i18n key as `createJsonEditor(..., { ariaLabel })` — see pages `AGENTS.md`.

`expectJsonEditorCtrlSSave(page, containerSelector, expect)` proves the container intercepts Ctrl+S: dispatches a synthetic `keydown` on `.cm-content` with a capture-phase probe on the container (registered after the product listener, same element/phase → fires after it) and asserts `defaultPrevented`. Needed because `vanilla-jsoneditor` `stopPropagation()`s every keydown at `.jse-main`, so a bubble-phase container listener can never see Ctrl+S — the product handler must be capture-phase.

## Network diagnostics

`browser_diagnostics.mjs` (wired in `createFountFixtures` / `createPagesFixtures`):

- `response ≥ 400` / `requestfailed` → `[browser:network]` noise → imperfect wave.
- `pageerror`, `[test:…]` console (from `scripts/test/watch/`), and `[i18n:missing]` (from `geti18n`, no dedup) hard-fail.
- Dropped request failures: `net::ERR_BLOCKED_BY_ORB`, `net::ERR_ABORTED`.
- Child-frame `SecurityError` ignored via CDP only (`exception.className` + frame ≠ main; `isIgnoredChildFrameSecurityError`). Main-frame `SecurityError` still hard-fails.
- Pages fixtures ignore `/api/ping` and localhost/`127.0.0.1:8930` installer probe / `/eula` signal failures only (`shouldIgnoreBrowserNetwork` — both `requestfailed` and HTTP ≥400). Other hosts or other paths on `:8930` still count as noise.
- Install wait vs homepage: `?from=runner` enters installer wait (EULA + 8930). Bare `/wait/install/` stays the project homepage and does not probe 8930.
- Do not gate product code on `fount.test.enabled` to paper over these. **URLs are logged as-is** — fixtures must not put durable secrets in URLs.
- Locale load goes through i18n `loadLocaleData` / `setLanguage` — do not fetch `/api/getlocaledata` from test code.
- `loadLocaleData` / `initTranslations` use an epoch cache (`lib/epochCache.mjs`): `locale-updated` bumps the epoch so stale fetches never refill the cache, but **the in-flight result is still applied**. Do not re-read only `cache.get` after `await load` — that drops the bundle when the epoch moved and leaves `preferred` ≠ `main_locale` (page watch then reports `aria-label missing-zh` on English chrome).
- `pages_server.close` closes the `.github/pages` and `.git` watchers, then `closeAllConnections()` before `close()` — otherwise keep-alive sockets can hang the driver past the idle watchdog. Directory routes that resolve to hooked `index.html` send `text/html`. `icon_anime:frontend` uses this mapping server (not a repo-root static root): demo URL is `${FOUNT_TEST_BASE_URL}/imgs/icon_anime/`.
- Pages placeholders `__FOUNT_COMMIT_HASH__` / `__FOUNT_GIT_REF__` are substituted by `pages_server` (local) and `pages.yaml` `sed` (deploy). Git ref is the current branch (`rev-parse --abbrev-ref HEAD`), or the commit when detached. Do not hardcode `master` in Pages fetch URLs.

## Page watch

`watch` (`scripts/test/watch/`): mounts `fount.test.watch` (`kick` / `drain` / `holdLocale` / `releaseLocale` / `started`). Locale bootstrap then `loop.start()` — the only ready gate.

- a11y: MutationObserver dirty → axe; `[aria-ignore]` via shared `test/aria_ignore.mjs` + hub probes.
- svgTheme: when a visible `<svg>` is present, sweep `data-theme=light` / `data-theme=dark` and assert each SVG foreground (fill/stroke/currentColor) stays at OKLab ΔE >= threshold from its backing background; an icon that vanishes under one theme fails via `[test:svg]`. Measurement runs inside an `ignore()` block with transitions/animations disabled, then restores the theme. Two measurement blind spots are skipped as unreliable: (1) drawing elements inside non-drawing containers (`mask`/`defs`/`clipPath`/…) whose internal fill/stroke are mask templates, not visible foreground; (2) icons in positioned overlays whose only opaque ancestor background is the page root (`html`/`body`) — their true backing is sibling-painted content (hero animations etc.), not the root background.
- cssvar: scan same-origin `<link>` stylesheets (skip injected Tailwind `<style>` / CDN daisyUI) for CSS variable health — (1) a bare `var(--x)` (no fallback) that no element can resolve → define it or remove the usage; (2) a declared `--x:` that is never referenced by any `var()` during the test → extend test coverage or drop the dead variable. References accumulate across DOM-mutation rescans (including fallback usages and nodes later removed), so unused detection reflects runtime tracking rather than a one-shot snapshot. Same-origin variables only; third-party libraries are ignored to avoid false positives.
- locale: zh-CN → ja-JP → en-UK (`holdLocale` skips); no `[data-i18n]` = textless page (skip rotation; axe also skips `html-has-lang`). Visible-text + **aria-label** scans (skip `[user-content]` / `[language-check-ignore]` / `[aria-hidden="true"]` / `[inert]` / `[hidden]` / `.hidden`) require Han on zh-CN and Hira/Kata/Han on ja-JP; en-UK must not carry CJK. Use `data-i18n` object keys — never hardcode English `aria-label` as a fallback. `[user-content]` = user/dynamic text; `[language-check-ignore]` = intentional multilingual chrome (language names, EULA in a chosen locale).
- Playwright teardown `waitForWatchDrain` → `watch.drain()`. Pause rotation during asserts with `holdLocale` / `releaseLocale` (see `json_editor.mjs`).
- Hard-fail on `[test:a11y]` / `[test:cssvar]` / `[test:locale]` / `[test:watch]` except axe `color-contrast`, `link-in-text-block`, and `html-has-lang` when the document has no `[data-i18n]` (no chrome copy). Prefer `[data-i18n="…"]` selectors. UI chrome must use `data-i18n` / `setLocalizeLogic`.

Icon-only controls need a visible glyph/SVG (or explicit size) — aria-label alone yields a 0×0 box and Playwright `toBeVisible` reports hidden. Incomplete UI must use `aria-hidden` / `inert` / `hidden` (not bare `opacity: 0`).

## Feed / media / seed

- **Scroll / infinite feed**: `infiniteScroll` is rising-edge armed — after `onLoad` the sentinel must leave then re-enter. Use Social `pumpFeedScroll`. Match feed API by exact pathname (`/api/parts/shells:social/feed`) — `includes('/feed')` also hits `feed.mjs`. Prefer the first no-cursor feed JSON as the page-size baseline. Assert DOM outcome, not bare telemetry. Shrink page size with `page.route` + `route.continue({ url })` rewriting `limit`; register before the first `openHome`.
- **Double-tap**: prefer `dblclick()`, or fire both events inside one `page.evaluate` — sequential `dispatchEvent('pointerup')` often exceeds a 300–350ms window under load.
- **Context-menu positioning**: `locator.dispatchEvent('contextmenu', { clientX, clientY })` builds a generic `Event` that **ignores** `clientX`/`clientY`, so handlers reading `event.clientX/Y` (e.g. `positionContextMenu`) get `NaN` and render the menu off-screen — `toBeVisible()` passes (it has a box) but `click()` fails "outside of the viewport". Dispatch a real `MouseEvent` with coordinates via `locator.evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY })))`, or use a genuine right-click (`click({ button: 'right' })`) which carries real pointer coordinates.
- Prefer local `page.route` over external media. Fix broken Iconify names; do not allowlist 404s. Social fixtures stub missing EVFS media on the **context** fixture via RegExp (`/files/profile/(sfw_)?avatar`, `/files/shells/social/attachments/`) — not globs (paths contain `shells:chat` colons). Fulfill GET/HEAD with a 1×1 PNG, `continue` other methods. Do **not** `route.fetch` that URL inside the handler. Real short-video bytes use `/__fount_test__/tiny.mp4`. Leave fullscreen `#videosView` via `#videosViewBackButton` or empty-state compose.
- **Timeline seed**: same-entity post append must be **serial** in fixtures (`seedPostsViaApi`). Concurrent POSTs to one timeline drop events (signature chain race); `ensureFeedHasNextPage` loops serial seed until `nextCursor` exists.
