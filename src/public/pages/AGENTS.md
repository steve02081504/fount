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
- **No client-side timeouts on backend links.** Do not wrap local `/api/*` (or same-origin backend) `fetch` / WS with `AbortSignal.timeout`, artificial deadlines, or “give up if slow” logic. If the backend hangs or times out, that is a backend bug — fix the server, do not add frontend complexity to paper over it. UI supersession abort (e.g. user navigated away / started a newer enter) is fine; do not pass that signal into backend fetch just to simulate a timeout.
- **`endpoints/base.mjs`**: Core auth/system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`endpoints/parts.mjs`**: `runPart`, `loadPart`, `getPartList`, `getPartDetails`, `setDefaultPart`.
- **`endpoints/server_events.mjs`**: `onServerEvent` — server-sent event bus.
- **`endpoints/registries.mjs`**: `GET /api/registries/:name` + dynamic `import()`.
- **`endpoints/p2p/evfsMedia.mjs`**: EVFS GET/PUT (`fetchEvfsFile`, `fetchMediaRef`, `uploadEvfsFile`, `uploadEvfsAttachment`). Pure URL helpers stay Deno-pure in chat `shared/evfsMedia.mjs` (`entityFileUrl`, `mediaRefUrl`).
- **`debug_log.mjs`**: `debugLog(name, data)` → `debug_logs/`.
- **HTML templates**: use `renderTemplate` / `mountTemplate` / `withTemplates` — never `fetch(…html)`.

## UI & Theming

- **`base.css`**: shared page chrome. `.hidden { display: none !important }` — do not re-declare in shells; page-local `display: flex|grid` must not un-hide toggled UI.
- **Component CSS**: inject at module import (`document.head.prepend`), same as `jsonEditor` / `markdown/convertor` — do not lazy-`ensure*` stylesheet links on first use. Registry-driven CSS (e.g. markdown extensions) stays async-load.
- **`theme.mjs`**: DaisyUI theme management. Call `applyTheme()` first.
- **`template.mjs`**: `renderTemplate` / `mountTemplate` / `renderTemplateAsHtmlString` / `withTemplates(path, fn)`. Cross-shell shared modules must **not** call bare `usingTemplates` — use `withTemplates` or direct DOM.
- **`dialog.mjs`**: `openDialogFromTemplate` / `pickFromDialog`. Templates supply `modal-box` (+ optional `modal-backdrop`) only — do not nest another `<dialog>`.
- **`promptDialog.mjs`**: shared DaisyUI `promptText` / `promptTextArea` / `confirmAction`. Prefer over `window.prompt` / `confirm` / shell-local copies. **First argument is always an i18n key**; optional third arg is interpolation params. Do not pass `geti18n(...)` strings. Modal title is **`h2`** (page already has `h1`; DaisyUI docs’ `h3` skips a level and trips axe `heading-order`).
- **`components/jsonEditor.mjs`**: `createJsonEditor(container, options)` wraps `vanilla-jsoneditor` (≥3.13). **`options.ariaLabel` is required and must be an i18n key** (resolved + refreshed via `setLocalizeLogic`); do not pass `geti18n(...)` strings. Optional `onSave` is Ctrl+S only — not a library prop. Keep native `get()`/`set()` (`Content`); use **`getJson()`** for parsed values (`{ json }` as-is; `{ text }` → `jsonrepair` then `JSON.parse`).
- **`components/imageEditor.mjs`**: `openImageEditor(file, labels?)` — crop / mosaic / brush modal; returns `File | null`. Defaults under `util.imageEditor.*` (+ `util.common.cancel`).
- **`components/mediaViewer.mjs`**: `openMediaViewer(items, startIndex?)` — fullscreen image/video viewer (ESC / arrows / wheel zoom / drag / download). Defaults under `util.mediaViewer.*`.
- **`lib/formatBytes.mjs`**: `formatBytes(bytes, decimals?)` — human-readable 1024-base sizes (`1.5 MB`).
- **`components/positionContextMenu.mjs`** + **`components/contextMenuDismiss.mjs`**: shared floating-menu placement / dismiss.
- **`contentReveal.mjs`**: `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang` (-> `primaryLocale()`).
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`errorHandlers.mjs`**: `handleError(i18nKey, toastParams?)` returns a `.catch` closure (toast + console + Sentry). Immediate form: `handleError(i18nKey, toastParams, error)`. **Only for fount faults** — user mistakes use `showToastI18n` directly. Backend twin: `fount/scripts/errorHandlers.mjs` (`handleError(error, ...extras)`).

## Rendering & Content

- **`lib/escapeHtml.mjs`**: escape `& < > " '` via string replace. Do **not** use `textContent`/`innerHTML` round-trip — leaves `"` unescaped.
- **`markdown.mjs`**: Markdown → HTML (KaTeX, Mermaid, Shiki). Shells use `getConvertor` / `renderMarkdownAsString` with `allowDangerousHtml`. Details: [docs/markdown-notes.md](docs/markdown-notes.md).
- **`markdown/standaloneDocument.mjs`**: `renderMarkdownAsStandaloneDocument` / `wrapStandaloneMarkdownDocument` — offline full HTML for Chat/Social download/share/drag. Filenames from document `<title>` via `fileNameFromHtmlTitle` / `downloadHtmlDocument`.
- **`sanitizeHtml.mjs`**: `sanitizePermissiveHtml` — rich displayName HTML minus script / `style` / `on*` / dangerous URLs. `scrubHtmlActivePayload(string|root)` — string → `<template>` scrub → `DocumentFragment`; DOM root → in-place; strips `on*` / all `srcset` / unsafe URLs (keeps `style`). Prefer the string path over live-`innerHTML` then scrub. `isSafeHtmlUrl` rejects `javascript:` / `data:` / protocol-relative `//…` and `/\…`.
- **`embedCard.mjs`**: `ALL /api/no-cors?url=` + OG parse; `MutationObserver` hydration; session LRU. Proxy details: [docs/markdown-notes.md](docs/markdown-notes.md#no-cors-proxy).
- **`emojiPicker.mjs`**: Shared emoji picker (click inserts token; Hub long-press/right-click sends sticker). Section headers / Alt·right-click on the rail open `emojiPackPreview`. Floating placement in `components/floatingPanel.mjs`. Hub mounts via `mountDockedEmojiPicker`.
- **`emojiPackPreview.mjs`**: Pack preview card (info + join/follow/favorite); `showEmojiPackPreview(anchor, { pack, provider, available })`.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. Switch UI language with **`setLanguage(string[])`** (writes preferredLangs + reloads via platform `i18n/base.mjs`). Raw bundle without applying: **`loadLocaleData(string[])`** (fount → `/api/getlocaledata`; Pages → static `locales/*.json`). Prefer these over ad-hoc fetch. `data-i18n`, `geti18n`, `setElementI18n`, `primaryLocale()` (preferredLangs[0] → `main_locale`, default `en-UK`). Use for content locale / translation target — do not hardcode `zh-CN` or bare `navigator.language`. Missing keys → `console.warn('[i18n:missing] …')`; Playwright fixtures hard-fail on that prefix. Locale map slices: `matchLocale` / `getBestLocale` / `pickLocalizedSlice` (`i18n/locale_match.mjs`, same as backend). Params / placeholders: [docs/i18n-notes.md](docs/i18n-notes.md). **Never hardcode English `aria-label` as a fallback** — page watch requires Han in aria-labels on zh pages and Japanese script on ja pages; use `data-i18n` objects with `aria-label`.
- **`features/emoji/`**: `providers`, `order` (5-tier sort), `packPresentation`, `packIndex` (content URLs + IndexedDB), `unicodeData` (`UNICODE_EMOJI_GROUP_I18N_KEYS`; rail glyph = first emoji in group after load), `discover`.

## Components & Utilities

- **`lib/memo.mjs`**: `createLruMap` / `dedupeAsync` / `memoizePromise`. Cache hits still return `Promise.resolve(value)` — callers may `.catch` / `.then`; never return the bare cached value.
- **`lib/virtualList.mjs`**: Virtual scrolling. Optional `getItemKey` enables keyed reconcile on `refresh()`.
- **`lib/infiniteScroll.mjs`**: `ensureScrollSentinel` / `insertBeforeScrollSentinel` / `bindInfiniteScroll` / `disconnectInfiniteScroll`. Sentinel stays last via `insertBeforeScrollSentinel`. Rising-edge / replay traps: Social [ui-details.md](../parts/shells/social/public/docs/ui-details.md#feed-pagination--replay).
- **`lib/base64.mjs`**: `arrayBufferToBase64` / `blobToBase64` — reuse for upload bodies; do not copy per shell.
- **`lib/svgInliner.mjs`**: Inline `.svg` `<img>` for `currentColor`. Put `svg-inliner-ignore` on user/media avatars so they stay `<img>` (inlining untrusted SVG activates scripts).
- **`user-content`**: boolean attr on user/dynamic text & inputs (post/reply bodies, message bubbles, composer fields, …). Page `watch` locale-script scan hides `[user-content]` — same opt-out style as `svg-inliner-ignore`.
- **`aria-ignore`**: value **must** be a GitHub issue URL. Policy + closed-issue hard-fail: [test AGENTS](../../scripts/test/AGENTS.md) Operator tools. JSON editor: [svelte-jsoneditor#584](https://github.com/josdejong/svelte-jsoneditor/issues/584).
- **Transitional a11y**: page `watch` reports axe hits immediately. Incomplete UI must use `aria-hidden` / `inert` / `hidden` (not bare `opacity: 0`). Fix the product — do not soften the watcher.
- **`credentialManager.mjs`** / **`host/urlDataTransfer.mjs`**: Secure credential encryption/transfer; Catbox upload/download via `host/catbox.mjs`.

## P2P (Browser)

Import via `esm.sh`. Shared primitives live in `shells/chat/public/shared/` (`/parts/shells:chat/shared/…`). EVFS URL helpers (`entityFileUrl` / `mediaRefUrl`) stay Deno-pure in chat `shared/evfsMedia.mjs`; browser fetch/upload is `/scripts/endpoints/p2p/evfsMedia.mjs`. Entity HTTP: `/api/parts/shells:chat/{viewer,entities…}`; network: `/api/p2p/{network,denylist,mailbox,federation}`.
