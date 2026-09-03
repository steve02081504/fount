---
description: Frontend shared page utilities (API, i18n, theming, templates, markdown)
globs: src/public/pages/**
alwaysApply: false
---

# Frontend Common Functions Guide

**Location**: `@src/public/pages/scripts/` — consult before implementing new frontend logic.

Markdown convertor traps (rehype order, `{:lang}`, trust tiers): [docs/markdown-notes.md](docs/markdown-notes.md).
`data-i18n` params / placeholders / persistent chrome: [docs/i18n-notes.md](docs/i18n-notes.md).

## API & Communication

- **Global HTTP lives in `scripts/endpoints/`** (`base.mjs`, `parts.mjs`, `registries.mjs`, `server_events.mjs`, `p2p/evfsMedia.mjs`). Import via `/scripts/endpoints/…`. **Named functions only** — no path-string clients. Shell-local REST belongs in that shell’s `public/src/endpoints.mjs` / `endpoints/*` (see shells AGENTS).
- **No client-side timeouts on backend links.** Do not wrap local `/api/*` fetch / WS with `AbortSignal.timeout` or artificial deadlines — fix the server instead. UI supersession abort (navigate away / newer enter) is fine; do not pass it into backend fetch just to simulate a timeout.
- **`endpoints/base.mjs`**: Core auth/system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`endpoints/parts.mjs`**: `runPart`, `loadPart`, `getPartList`, `getPartDetails`, `setDefaultPart`.
- **`endpoints/server_events.mjs`**: `onServerEvent` — server-sent event bus.
- **`endpoints/registries.mjs`**: `GET /api/registries/:name` + dynamic `import()`. GitHub Pages overrides this file under `.github/pages/scripts/` (`cp -n`).
- **`endpoints/p2p/evfsMedia.mjs`**: EVFS GET/PUT (`fetchEvfsFile`, `fetchMediaRef`, `uploadEvfsFile`, `uploadEvfsAttachment`). Pure URL helpers stay Deno-pure in chat `shared/evfsMedia.mjs` (`entityFileUrl`, `mediaRefUrl`).
- **`debug_log.mjs`**: `debugLog(name, data)` → `debug_logs/`.
- **HTML templates**: import bound helpers from the shell’s `templates.mjs` (or `templatesFor(root)` / `dialogsFor(root)`) — never `fetch(…html)`.

## UI & Theming

- **`base.css`**: shared page chrome. `.hidden { display: none !important }` — do not re-declare in shells; page-local `display: flex|grid` must not un-hide toggled UI.
- **daisyUI 5 dropdown**: while open, the trigger gets `pointer-events: none` — after a menu item click, `document.activeElement?.blur()` to close the menu before the trigger is clickable again (wait/install language selector, blog menus).
- **Component CSS**: inject at module import (`document.head.prepend`) — do not lazy-`ensure*` stylesheet links on first use. Registry-driven CSS (e.g. markdown extensions) stays async-load. Link the stylesheet via `new URL('./<name>.css', import.meta.url).href` — a hardcoded `/scripts/…` href breaks under subpath mounts (GitHub Pages `/fount`).
- **`theme.mjs`**: DaisyUI theme management. Call `applyTheme()` first.
- **`template.mjs`**: `templatesFor(root)` returns bound `renderTemplate` / `mountTemplate` / `appendTemplate` / `renderTemplateAsHtmlString` / …. Shells expose a local `templates.mjs` that calls `templatesFor` (+ `dialogsFor` when needed); call sites import from that module — never global `usingTemplates` / `withTemplates`. HTML helpers (`createDocumentFragment*`, `createDOM*`, `activateScripts`) stay on `template.mjs`. Fetch cache keyed by full URL; failed fetches are not cached.
- **`dialog.mjs`**: `dialogsFor(root)` → `openDialogFromTemplate` / `pickFromDialog` / …. Shared prompt/confirm templates: `/scripts/features/templates.mjs`. Templates supply `modal-box` (+ optional `modal-backdrop`) only — do not nest another `<dialog>`.
- **`promptDialog.mjs`**: shared DaisyUI `promptText` / `promptTextArea` / `confirmAction`. Prefer over `window.prompt` / `confirm` / shell-local copies. **First argument is always an i18n key**; optional third arg is interpolation params. Do not pass `geti18n(...)` strings. Modal title is **`h2`** (page already has `h1`).
- **`components/jsonEditor.mjs`**: `createJsonEditor(container, options)` wraps `vanilla-jsoneditor` (≥3.13). **`options.ariaLabel` is required and must be an i18n key** (via `setLocalizeLogic`); do not pass `geti18n(...)` strings. Optional `onSave` is Ctrl+S only. Keep native `get()`/`set()` (`Content`); use **`getJson()`** for parsed values — it first triggers `validate()` to flush the text-mode 300ms onChange debounce, so it never returns stale content right after typing; then `{ json }` as-is, `{ text }` → `jsonrepair` + `JSON.parse`. `onSave` is registered with a **capture-phase** keydown listener — `vanilla-jsoneditor` `stopPropagation()`s every keydown at `.jse-main`, which would otherwise swallow Ctrl+S.
- **`components/imageEditor.mjs`**: `openImageEditor(file, labels?)` — crop / mosaic / brush; returns `File | null`. Defaults under `util.imageEditor.*`.
- **`components/mediaViewer.mjs`**: `openMediaViewer(items, startIndex?)` — fullscreen image/video. Defaults under `util.mediaViewer.*`.
- **`lib/formatBytes.mjs`**: `formatBytes(bytes, decimals?)` — 1024-base sizes (`1.5 MB`).
- **`components/positionContextMenu.mjs`** + **`components/contextMenuDismiss.mjs`**: shared floating-menu placement / dismiss.
- **`contentReveal.mjs`**: `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang` (-> `primaryLocale()`).
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`errorHandlers.mjs`**: `handleError(i18nKey, toastParams?)` → `.catch` closure; immediate form takes `error` as third arg. **Only for fount faults** — user mistakes use `showToastI18n`. Backend twin: `fount/scripts/errorHandlers.mjs` (first arg is the error).

## Rendering & Content

- **`lib/escapeHtml.mjs`**: escape `& < > " '` via string replace — not `textContent`/`innerHTML` round-trip (leaves `"` unescaped).
- **`markdown.mjs`**: Markdown → HTML (KaTeX, Mermaid, Shiki). Shells use `getConvertor` / `renderMarkdownAsString` with `allowDangerousHtml`. Details: [docs/markdown-notes.md](docs/markdown-notes.md).
- **`markdown/extensions.mjs`**: `markdown_extensions` registry — one module per part drives **both** render and editor. `remarkPlugins`/`rehypePlugins`/`css`/`init` feed the convertor (see `convertor.mjs GetMarkdownConvertor`); `inlineTokens` (`{ kind, regex, parse?, resolveLabel?, buildChip? }`) feed `markdownRichInput.mjs` (scan + chips); `mentionSuggest` (`(ctx, query, limit) => Promise<rows|null>`) feed `/scripts/components/mentionAutocomplete.mjs`. Sync accessors: `getRegisteredInlineTokens()` / `getRegisteredMentionSuggest()`.
- **`components/markdownRichInput.mjs`**: shared contenteditable composer (textarea-compatible API). Token scanning/chips come from registered `inlineTokens` — do not hardcode new token kinds here; register them as a markdown extension. Per-instance `resolveTokenLabel` stays the label override. Options `inlineTokens` (extra token defs, priority first) + `useRegisteredInlineTokens: false` (drop the registry's tokens) let a shell like a code editor supply its own token set (e.g. `@file:…`) without registering global markdown extensions.
- **`components/mentionAutocomplete.mjs`**: shared `@`-autocomplete UI (`attachMentionAutocomplete(textarea, { getContext, providers, listboxPrefix, emptyI18n, accessibleLabelI18n, trailingSpace, onError })` + `insertTokenIntoComposer`). Chat/social wrap it thinly; providers are injected. Import from `/scripts/...` only — no shell modules.
- **`markdown/standaloneDocument.mjs`**: `renderMarkdownAsStandaloneDocument` / `wrapStandaloneMarkdownDocument` — offline full HTML for Chat/Social download/share/drag. Filenames via `fileNameFromHtmlTitle` / `downloadHtmlDocument`.
- **`sanitizeHtml.mjs`**: `sanitizePermissiveHtml` — rich displayName HTML minus script / `style` / `on*` / dangerous URLs. `scrubHtmlActivePayload(string|root)` — prefer string path (`DocumentFragment`) over live-`innerHTML` then scrub; strips `on*` / `srcset` / unsafe URLs (keeps `style`). `isSafeHtmlUrl` rejects `javascript:` / `data:` / `//…` / `/\…`.
- **`embedCard.mjs`**: `ALL /api/no-cors?url=` + OG parse; `MutationObserver` hydration; session LRU. Proxy details: [docs/markdown-notes.md](docs/markdown-notes.md#no-cors-proxy).
- **`emojiPicker.mjs`**: Shared picker (click inserts token; Hub long-press/right-click sends sticker). Rail headers / Alt·right-click → `emojiPackPreview`. Placement: `components/floatingPanel.mjs`. Hub: `mountDockedEmojiPicker`.
- **`emojiPackPreview.mjs`**: Pack preview (info + join/follow/favorite); `showEmojiPackPreview(anchor, { pack, provider, available })`.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. Switch UI with **`setLanguage(string[])`**; raw bundle: **`loadLocaleData(string[])`**. Prefer these over ad-hoc fetch. `data-i18n`, `geti18n`, `setElementI18n`, `primaryLocale()`. Missing keys → `console.warn('[i18n:missing] …')` (Playwright hard-fails). Params / placeholders / switch leaves / aria-label: [docs/i18n-notes.md](docs/i18n-notes.md).
- **`features/emoji/`**: `providers`, `order` (5-tier), `packPresentation`, `packIndex`, `unicodeData` (`UNICODE_EMOJI_GROUP_I18N_KEYS`), `discover`.

## Components & Utilities

- **`components/terminal.mjs`**: `setTerminal` — xterm + FitAddon. **`convertEol: true`** (TTY ONLCR: `\n` → start of next line). `stdin` / `stdout` / `stderr` match `process.std*`.
- **`lib/memo.mjs`**: `createLruMap` / `dedupeAsync` / `memoizePromise`. Cache hits still return `Promise.resolve(value)` — never the bare cached value.
- **`lib/virtualList.mjs`**: Virtual scrolling. Optional `getItemKey` enables keyed reconcile on `refresh()`.
- **`lib/infiniteScroll.mjs`**: `ensureScrollSentinel` / `insertBeforeScrollSentinel` / `bindInfiniteScroll` / `disconnectInfiniteScroll`. Rising-edge / replay traps: Social [ui-details.md](../parts/shells/social/public/docs/ui-details.md#feed-pagination--replay).
- **`lib/base64.mjs`**: `arrayBufferToBase64` / `blobToBase64` — reuse; do not copy per shell.
- **`lib/svgInliner.mjs`**: Inline `.svg` `<img>` for `currentColor`. Put `svg-inliner-ignore` on user/media avatars (inlining untrusted SVG activates scripts).
- **`user-content`**: boolean attr on user/dynamic text & inputs. Page `watch` locale scan skips it. Empty value skips the whole subtree (visible text + `aria-label`); `user-content="aria-label"` skips only that element's own `aria-label` while children stay checked.
- **`language-check-ignore`**: boolean attr on intentional multilingual chrome (language name lists, EULA in a chosen locale). Same locale-scan skip as `user-content`; do not use `user-content` for that.
- **`aria-ignore`**: value **must** be a GitHub issue URL. Policy: [test AGENTS](../../scripts/test/AGENTS.md) Operator tools.
- **Incomplete UI a11y**: use `aria-hidden` / `inert` / `hidden` (not bare `opacity: 0`). Fix the product — do not soften page `watch`. Floating `position: fixed` overlays with region-role (`role="toolbar"` etc.) appended to `document.body` trip the axe `region` rule (`[test:a11y] … not contained by landmarks`); wrap them in a `<nav>` landmark (see `markdownRichInput.mjs` `getToolbar`).
- **`credentialManager.mjs`** / **`host/urlDataTransfer.mjs`**: credential encryption/transfer; Catbox via `host/catbox.mjs`.

## P2P (Browser)

Import via `esm.sh`. Shared primitives: `shells/chat/public/shared/` (`/parts/shells:chat/shared/…`). Entity HTTP: `/api/parts/shells:chat/{viewer,entities…}`; network: `/api/p2p/{network,denylist,mailbox,federation}`.
