# Playwright frontend notes

Day-to-day selectors / taxonomy: [AGENTS.md](../AGENTS.md). This file is fixtures, browser binary, CDN cache, network diagnostics, and page-watch traps.

## CLI args

`runPlaywright` / `runPlaywrightWithNode` accept `playwrightArgs` as `string | string[]`. Prefer an argv array (e.g. `process.argv.slice(2)`) so grep patterns and other values with spaces keep their token boundaries; a string is still split on whitespace for older call sites.

Single-config Pages driver (`.github/pages/test/frontend/run.mjs`) has no Playwright projects: it passes spec filenames from `playwrightArgsForSubtests` when `FOUNT_TEST_SUBTESTS` is set (`pages:frontend:wait` → `wait.spec.mjs`). Do not rely on argv slice alone or a named subtest still runs every `*.spec.mjs`.

## Module logic page (`modulePage`)

Testing a browser module's logic without booting a whole shell UI: every `createFountFixtures` frontend suite exposes a `modulePage` fixture (`src/scripts/test/playwright/module_page.mjs`). It fulfills a **same-origin minimal routed page** with `fount.test.watch.disabled` set (pages `base.mjs` skips the page-watch a11y/locale sweeps; `enabled` stays on to keep Sentry off) and loads the i18n bundle explicitly (`[i18n:missing]` safe), then `run` evaluates a closure-free function in the page. Assertions stay Node-side; rich objects survive the structured-clone boundary.

```mjs
import { expect, test } from './fixtures.mjs'

test('secure render keeps spoiler onclick', async ({ modulePage }) => {
	const html = await modulePage.run(async () => {
		// 昂贵对象挂页面常驻 store，跨用例复用（processor 构建很贵）
		const store = globalThis.__fountModulePage
		store.convertor ??= await import('/scripts/features/markdown/index.mjs')
		return store.convertor.renderMarkdownAsString('||secret||', undefined, { allowDangerousHtml: false, isStandalone: true })
	})
	expect(html).toContain('class="spoiler"')
})
```

Rules:

- The `run` callback must be **closure-free** (Playwright serializes it via `toString`); pass data via the second `run(fn, arg)` argument. Functions / class instances cannot cross back — return plain data (strings, numbers, plain objects) or do DOM work inside the callback and return counts/summaries.
- Module URLs are browser-absolute: `/scripts/…` (pages scripts), `/parts/<partpath>/…` (part `public/`). Backend-only dirs (`parts/*/src/**`, plugins) are **not served** — logic living there stays in Deno tests.
- Prefer the browser's own cached entries (`features/markdown/index.mjs getConvertor`) over rebuilding processors per call.
- Detached containers (`document.createElement('div')`, never appended) keep DOM assertions off the page-watch MutationObserver; append to `document.body` only when connection itself is the subject.
- `StreamRenderer`-style classes work on detached elements via `finish()` (rAF loop short-circuits when not connected).

This is the sanctioned replacement for the old happy-dom Deno tests: Deno test children explode on DOM-global assignment (`deno/no_dom_shim.mjs` preload) — see test [AGENTS.md](../AGENTS.md#writing-new-tests).

## Fixtures

`createFountFixtures({ locale, isolated? })` — `isolated` registers `FOUNT_TEST_USERNAME` + `assertIsolatedFrontendTest` (Chat/Social/Cabinet). Locale `addInitScript` wraps `localStorage` in try/catch (`about:blank` / sandboxed frames throw `SecurityError`). When `FOUNT_TEST_HUB_URL` is set (parent hub `127.0.0.1:8903`), fixtures also inject `fount.test.hubUrl` for in-page hub clients / page `watch`.

API helpers in `playwright/api.mjs`: `withApiRequest`, `fetchViewerEntityHash`, `createChatTestGroup`. Prefer these over local `request.newContext` loops.

## Browser binary

`browser.mjs`: reuse PATH Chrome/Edge locally (no download). On `GITHUB_ACTIONS=true` without a system browser, `playwright install --with-deps chrome` then `channel: 'chrome'`. Launch args include `--disable-component-update` (avoids mid-flight cert-verifier swaps that cancel esm.sh loads). Fixtures use `serviceWorkers: 'block'` so `page.route` is not bypassed by the app SW.

## CDN response cache

`cdn_cache.mjs` (wired into `createFountFixtures` / Pages fixtures `context`): memory + `data/test/cdn_cache` disk reuse for GET/HEAD to `esm.sh` / `api.iconify.design` / `cdn.jsdelivr.net` / `data.jsdelivr.com` / `api.github.com`, cutting cross-case network flakiness. Cache keys include method so GET and HEAD never share an entry. Cached GET fulfill headers drop `content-encoding` and set `content-length` to the plaintext body size; HEAD fulfills keep the upstream headers (empty body must not rewrite `content-length`). Requests with `Range` bypass the cache. Only 2xx/3xx are cached; 4xx stay live (bad Iconify names still count as noise). If `route.fetch` succeeds but `response.body()` throws disposed/closed (page teardown), abort the route instead of failing the test. `FOUNT_TEST_CDN_CACHE=0` disables. `route.fetch` is fine for CDN URLs; do not fetch same-origin local URLs that way (see Social EVFS stub).

**Staleness revalidation**: on a cache hit for a *mutable* URL (unversioned esm.sh paths, jsDelivr `/npm/` without a version segment or `/gh/` refs, everything on `data.jsdelivr.com` / `api.iconify.design` / `api.github.com`), the entry is revalidated at most once per URL per 10-minute TTL (`fail-open`: probe/refetch errors serve the cache). Policy auto-degrades by what the cached entry carries: a version checknum header (`x-esm-path` / `x-jsd-version`) → cheap HEAD comparison, refetch on mismatch; else `etag` / `last-modified` → conditional GET (`If-None-Match` / `If-Modified-Since`), 304 serves the cache, 200 overwrites it; else an unconditional refetch. Versioned paths are treated as immutable pure cache. Bumping a browser-facing package served via unversioned `esm.sh` URLs (e.g. `@steve02081504/fount-p2p`, `@steve02081504/async-eval`) therefore self-heals on the next run — no manual `data/test/cdn_cache` deletion; within the ~10-minute upstream edge-cache window after a publish a cold run may still see the old build once and heals the run after.

## JSON editor a11y

`json_editor.mjs` → `expectJsonEditorAriaLabel(page, containerSelector, i18nKey, expect)` asserts `vanilla-jsoneditor` text-mode `.cm-content` `aria-label` matches `geti18n(key)`. Product wrappers must pass an i18n key as `createJsonEditor(..., { ariaLabel })` — see pages `AGENTS.md`.

`expectJsonEditorCtrlSSave(page, containerSelector, expect)` proves the container intercepts Ctrl+S: dispatches a synthetic `keydown` on `.cm-content` with a capture-phase probe on the container (registered after the product listener, same element/phase → fires after it) and asserts `defaultPrevented`. Needed because `vanilla-jsoneditor` `stopPropagation()`s every keydown at `.jse-main`, so a bubble-phase container listener can never see Ctrl+S — the product handler must be capture-phase.

## Network diagnostics

`browser_diagnostics.mjs` (wired in `createFountFixtures` / `createPagesFixtures`):

- `response ≥ 400` / `requestfailed` → `[browser:network]` noise → imperfect wave.
- `pageerror`, `[test:…]` console (from `scripts/test/watch/`), and `[i18n:missing]` (from `geti18n`, no dedup) hard-fail.
- General `console.error` (console `type() === 'error'`) always fails: reaching `MAX_CONSOLE_ERRORS` (13) aborts the test immediately (fail-fast, `runDiagnosedPage` races `use` against the abort promise; the collected error texts are dumped to the log first — `[console-error-dump]` — so the threshold abort is never a counting-only blind spot); 1–12 errors fail at teardown. Browser auto-emitted `Failed to load resource: …` messages (requestfailed / HTTP ≥400) are **excluded** from this rule — they belong to the network diagnostics below and would double-count expected probes; real page `console.error()` calls still hard-fail.
- `[i18n:clobber]` (`clobber_guard.mjs`): a `data-i18n` leaf/`textContent`/`innerHTML` key replacing a subtree that contains non-text tags warns. The whitelist is **dynamic**: base text tags (`div/p/br/code/span/a`) ∪ tags actually appearing in locale bundle values (seeded by `setI18nBundle` — inline formatting like `i`/`em`/`strong` is allowed automatically) minus a hard-banned set (`svg/img/button/input/…` — even in locale values). `i18nClobberErrors` is asserted in both Pages and chat fixtures. Backdrop `form.method="dialog"` must bind the key to its inner submit `<button>`, not the `<form>` (textContent assignment would erase the button and break click-to-close).
- Dropped request failures: `net::ERR_BLOCKED_BY_ORB`, `net::ERR_ABORTED`.
- Child-frame `SecurityError` ignored via CDP only (`exception.className` + frame ≠ main; `isIgnoredChildFrameSecurityError`). Main-frame `SecurityError` still hard-fails.
- Pages fixtures ignore `/api/ping` and localhost/`127.0.0.1:8930` installer probe / `/eula` signal failures only (`shouldIgnoreBrowserNetwork` — both `requestfailed` and HTTP ≥400). Other hosts or other paths on `:8930` still count as noise. The Pages fixture additionally drops all `localhost`/`127.0.0.1:8931` failures via a diagnostics `shouldIgnoreNetwork` predicate (no fount node on the static site — install-wait probing and cold-boot prerender of `8931/parts/shells/home` are expected to be unreachable).
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
- cssvar: scan same-origin `<link>` stylesheets (skip injected Tailwind `<style>` / CDN daisyUI) for CSS variable health — (1) a bare `var(--x)` (no fallback) that no element can resolve → define it or remove the usage; (2) a declared `--x:` that is never referenced by any `var()` during the test → extend test coverage or drop the dead variable. References accumulate across DOM-mutation rescans (including fallback usages and nodes later removed), so unused detection reflects runtime tracking rather than a one-shot snapshot. Same-origin variables only; third-party libraries are ignored to avoid false positives. A variable that hands a value **into** an out-of-scope consumer (e.g. a daisyUI theme bridge like `--btn-color`, consumed by the CDN button sheet the scanner cannot read) is reported as unused — exempt it with a comment directive in the same stylesheet: `/* cssvar-external: --btn-color */` (space-separated `--` names). The scanner fetches same-origin `<link>` stylesheet text to read the directive (CSSOM strips comments) and reads inline `<style>` via `ownerNode.textContent`.
- locale: zh-CN → ja-JP → en-UK (`holdLocale` skips); no `[data-i18n]` = textless page (skip rotation; axe also skips `html-has-lang`). Visible-text + **aria-label** scans (skip `[user-content=""]` / `[language-check-ignore]` / `[aria-hidden="true"]` / `[inert]` / `[hidden]` / `.hidden`; `user-content="aria-label"` skips only that element's own `aria-label`) require Han on zh-CN and Hira/Kata/Han on ja-JP; en-UK must not carry CJK. Use `data-i18n` object keys — never hardcode English `aria-label` as a fallback. `[user-content]` = user/dynamic text; `[language-check-ignore]` = intentional multilingual chrome (language names, EULA in a chosen locale).
- Playwright teardown `waitForWatchDrain` → `watch.drain()`. Pause rotation during asserts with `holdLocale` / `releaseLocale` (see `json_editor.mjs`).
- Hard-fail on `[test:a11y]` / `[test:cssvar]` / `[test:locale]` / `[test:watch]` except axe `color-contrast`, `link-in-text-block`, and `html-has-lang` when the document has no `[data-i18n]` (no chrome copy). Prefer `[data-i18n="…"]` selectors. UI chrome must use `data-i18n` / `setLocalizeLogic`.

Icon-only controls need a visible glyph/SVG (or explicit size) — aria-label alone yields a 0×0 box and Playwright `toBeVisible` reports hidden. Incomplete UI must use `aria-hidden` / `inert` / `hidden` (not bare `opacity: 0`).

## Node-side module loader

`npm_register.mjs` (wired via `--import=` through `run.mjs`): resolves `npm:` specifiers from `node_modules` for Node-side test processes, and also maps **`https://esm.sh/<pkg>[@ver][/subpath]`** URLs onto the same npm resolution (query strings stripped) — browser-facing modules that import esm.sh URLs run identically under Deno and Node. Pin cross-runtime dependencies in `deno.json` `imports` (e.g. `npm:@steve02081504/async-eval`) so both runtimes agree on the version; esm.sh imports inside shared modules should carry an **explicit version** (an unversioned URL resolves to esm.sh's current latest, which can drift from the pinned one).

## Feed / media / seed

- **Scroll / infinite feed**: `infiniteScroll` is rising-edge armed — after `onLoad` the sentinel must leave then re-enter. Use Social `pumpFeedScroll`. Match feed API by exact pathname (`/api/parts/shells:social/feed`) — `includes('/feed')` also hits `feed.mjs`. Prefer the first no-cursor feed JSON as the page-size baseline. Assert DOM outcome, not bare telemetry. Shrink page size with `page.route` + `route.continue({ url })` rewriting `limit`; register before the first `openHome`.
- **Double-tap**: prefer `dblclick()`, or fire both events inside one `page.evaluate` — sequential `dispatchEvent('pointerup')` often exceeds a 300–350ms window under load.
- **Context-menu positioning**: `locator.dispatchEvent('contextmenu', { clientX, clientY })` builds a generic `Event` that **ignores** `clientX`/`clientY`, so handlers reading `event.clientX/Y` (e.g. `positionContextMenu`) get `NaN` and render the menu off-screen — `toBeVisible()` passes (it has a box) but `click()` fails "outside of the viewport". Dispatch a real `MouseEvent` with coordinates via `locator.evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY })))`, or use a genuine right-click (`click({ button: 'right' })`) which carries real pointer coordinates.
- Prefer local `page.route` over external media. Fix broken Iconify names; do not allowlist 404s. Social fixtures stub missing EVFS media on the **context** fixture via RegExp (`/files/profile/(sfw_)?avatar`, `/files/shells/social/attachments/`) — not globs (paths contain `shells:chat` colons). Fulfill GET/HEAD with a 1×1 PNG, `continue` other methods. Do **not** `route.fetch` that URL inside the handler. Real short-video bytes use `/__fount_test__/tiny.mp4`. Leave fullscreen `#videosView` via `#videosViewBackButton` or empty-state compose.
- **Timeline seed**: same-entity post append must be **serial** in fixtures (`seedPostsViaApi`). Concurrent POSTs to one timeline drop events (signature chain race); `ensureFeedHasNextPage` loops serial seed until `nextCursor` exists.
