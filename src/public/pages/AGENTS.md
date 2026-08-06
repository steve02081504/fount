---
description: Frontend shared page utilities (API, i18n, theming, templates, markdown)
globs: src/public/pages/**
alwaysApply: false
---

# Frontend Common Functions Guide

**Location**: `@src/public/pages/scripts/` — consult before implementing new frontend logic.

Markdown convertor traps (rehype order, `{:lang}`, trust tiers): [markdown-notes.md](markdown-notes.md).
`data-i18n` params / placeholders / persistent chrome: [i18n-notes.md](i18n-notes.md).

## API & Communication

- **`endpoints.mjs`**: Core auth/system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`debug_log.mjs`**: `debugLog(name, data)` → `debug_logs/`.
- **`parts.mjs`**: `runPart`, `loadPart`, `getPartList`, `setDefaultPart`.
- **`server_events.mjs`**: `onServerEvent` — server-sent event bus.

## UI & Theming

- **`base.css`**: shared page chrome. `.hidden { display: none !important }` — do not re-declare in shells; page-local `display: flex|grid` must not un-hide toggled UI.
- **Component CSS**: inject at module import (`document.head.prepend`), same as `jsonEditor` / `markdown/convertor` — do not lazy-`ensure*` stylesheet links on first use. Registry-driven CSS (e.g. markdown extensions) stays async-load.
- **`theme.mjs`**: DaisyUI theme management. Call `applyTheme()` first.
- **`template.mjs`**: `renderTemplate` / `mountTemplate` / `renderTemplateAsHtmlString` / `withTemplates(path, fn)`. Cross-shell shared modules must **not** call bare `usingTemplates` — use `withTemplates` or direct DOM.
- **`dialog.mjs`**: `openDialogFromTemplate` / `pickFromDialog`. Templates supply `modal-box` (+ optional `modal-backdrop`) only — do not nest another `<dialog>`.
- **`promptDialog.mjs`**: shared DaisyUI `promptText` / `promptTextArea` / `confirmAction`. Prefer over `window.prompt` / `confirm` / shell-local copies. **First argument is always an i18n key**; optional third arg is interpolation params. Do not pass `geti18n(...)` strings. Modal title is **`h2`** (page already has `h1`; DaisyUI docs’ `h3` skips a level and trips axe `heading-order`).
- **`components/jsonEditor.mjs`**: `createJsonEditor(container, options)` wraps `vanilla-jsoneditor` (≥3.13). **`options.ariaLabel` is required and must be an i18n key** (resolved + refreshed via `setLocalizeLogic`); do not pass `geti18n(...)` strings. Optional `onSave` is Ctrl+S only — not a library prop. Keep native `get()`/`set()` (`Content`); use **`getJson()`** for parsed values (`{ json }` as-is; `{ text }` → `jsonrepair` then `JSON.parse`).
- **`components/imageEditor.mjs`**: `openImageEditor(file, labels?)` — crop / mosaic / brush modal; returns `File | null`. Defaults under `util.imageEditor.*` (+ `util.common.cancel`).
- **`components/positionContextMenu.mjs`** + **`components/contextMenuDismiss.mjs`**: shared floating-menu placement / dismiss.
- **`contentReveal.mjs`**: `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang` (-> `primaryLocale()`).
- **`toast.mjs`**: `showToast`, `showToastI18n`.

## Rendering & Content

- **`lib/escapeHtml.mjs`**: escape `& < > " '` via string replace. Do **not** use `textContent`/`innerHTML` round-trip — leaves `"` unescaped.
- **`markdown.mjs`**: Markdown → HTML (KaTeX, Mermaid, Shiki). Shells use `getConvertor` / `renderMarkdownAsString` with `allowDangerousHtml`. Details: [markdown-notes.md](markdown-notes.md).
- **`markdown/standaloneDocument.mjs`**: `renderMarkdownAsStandaloneDocument` / `wrapStandaloneMarkdownDocument` — offline full HTML for Chat/Social download/share/drag. Filenames from document `<title>` via `fileNameFromHtmlTitle` / `downloadHtmlDocument`.
- **`sanitizeHtml.mjs`**: `sanitizePermissiveHtml` — rich displayName HTML minus script / `on*` / dangerous URLs. `scrubHtmlActivePayload(string|root)` — string → `<template>` scrub → `DocumentFragment`; DOM root → in-place. Prefer the string path over live-`innerHTML` then scrub. `isSafeHtmlUrl` rejects `javascript:` / `data:` / protocol-relative `//…`.
- **`embedCard.mjs`**: `ALL /api/no-cors?url=` + OG parse; `MutationObserver` hydration; session LRU. Proxy details: [markdown-notes.md](markdown-notes.md#no-cors-proxy).
- **`registries.mjs`**: `GET /api/registries/:name` + dynamic `import()`.
- **`emojiPicker.mjs`**: Shared emoji picker (click inserts token; Hub long-press/right-click sends sticker). Section headers / Alt·right-click on the rail open `emojiPackPreview`. Floating placement in `components/floatingPanel.mjs`. Hub mounts via `mountDockedEmojiPicker`.
- **`emojiPackPreview.mjs`**: Pack preview card (info + join/follow/favorite); `showEmojiPackPreview(anchor, { pack, provider, available })`.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. Switch UI language with **`setLanguage(string[])`** (writes preferredLangs + reloads via platform `i18n/base.mjs`). Raw bundle without applying: **`loadLocaleData(string[])`** (fount → `/api/getlocaledata`; Pages → static `locales/*.json`). Prefer these over ad-hoc fetch. `data-i18n`, `geti18n`, `setElementI18n`, `primaryLocale()` (preferredLangs[0] → `main_locale`, default `en-UK`). Use for content locale / translation target — do not hardcode `zh-CN` or bare `navigator.language`. Missing keys → `console.warn('[i18n:missing] …')`; Playwright fixtures hard-fail on that prefix. Locale map slices: `matchLocale` / `getBestLocale` / `pickLocalizedSlice` (`i18n/locale_match.mjs`, same as backend). Params / placeholders: [i18n-notes.md](i18n-notes.md).
- **`features/emoji/`**: `providers`, `order` (5-tier sort), `packPresentation`, `packIndex` (content URLs + IndexedDB), `unicodeData` (`UNICODE_EMOJI_GROUP_I18N_KEYS`; rail glyph = first emoji in group after load), `discover`.

## Components & Utilities

- **`lib/virtualList.mjs`**: Virtual scrolling. Optional `getItemKey` enables keyed reconcile on `refresh()`.
- **`lib/infiniteScroll.mjs`**: `ensureScrollSentinel` / `insertBeforeScrollSentinel` / `bindInfiniteScroll` / `disconnectInfiniteScroll`. Sentinel stays last via `insertBeforeScrollSentinel`. Rising-edge / replay traps: Social [ui-details.md](../parts/shells/social/public/ui-details.md#feed-pagination--replay).
- **`lib/base64.mjs`**: `arrayBufferToBase64` / `blobToBase64` — reuse for upload bodies; do not copy per shell.
- **`lib/svgInliner.mjs`**: Inline `.svg` `<img>` for `currentColor`. Put `svg-inliner-ignore` on user/media avatars so they stay `<img>` (inlining untrusted SVG activates scripts).
- **`user-content`**: boolean attr on user/dynamic text & inputs (post/reply bodies, message bubbles, composer fields, …). Page `watch` locale-script scan hides `[user-content]` — same opt-out style as `svg-inliner-ignore`.
- **`aria-ignore`**: attr value **must** be a GitHub issue URL (`aria-ignore="https://github.com/owner/repo/issues/n"`). Policy in `scripts/test/aria_ignore.mjs` (shared with Playwright teardown). Page `watch` axe-`exclude`s the subtree and flags missing/bad URLs; with `fount.test.hubUrl` (from `FOUNT_TEST_HUB_URL`, fixed `127.0.0.1:8903`) also fails closed issues in-page. Playwright teardown `assertAriaIgnoreIssues` hits the same hub. No hub / hub down → treat as still open. JSON editor: [svelte-jsoneditor#584](https://github.com/josdejong/svelte-jsoneditor/issues/584).
- **Transitional a11y**: page `watch` reports axe hits immediately (no confirm buffer). Incomplete / not-yet-shown UI must use `aria-hidden` / `inert` / `hidden` (not bare `opacity: 0`); text updates should be atomic. Fix the product — do not soften the watcher.
- **`credentialManager.mjs`** / **`host/urlDataTransfer.mjs`**: Secure credential encryption/transfer; Catbox upload/download via `host/catbox.mjs`.

## P2P (Browser)

Import via `esm.sh`. Shared primitives live in `shells/chat/public/shared/` (`/parts/shells:chat/shared/…`). Entity HTTP: `/api/parts/shells:chat/{viewer,entities…}`; network: `/api/p2p/{network,denylist,mailbox,federation}`.
