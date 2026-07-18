---
description: Frontend shared page utilities (API, i18n, theming, templates, markdown)
globs: src/public/pages/**
alwaysApply: false
---

# Frontend Common Functions Guide

**Location**: `@src/public/pages/scripts/` — consult before implementing new frontend logic.

## API & Communication

- **`endpoints.mjs`**: Core auth/system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`debug_log.mjs`**: `debugLog(name, data)` → `debug_logs/`.
- **`parts.mjs`**: `runPart`, `loadPart`, `getPartList`, `setDefaultPart`.
- **`server_events.mjs`**: `onServerEvent` — server-sent event bus.

## UI & Theming

- **`theme.mjs`**: DaisyUI theme management. Call `applyTheme()` first.
- **`template.mjs`**: `renderTemplate` / `mountTemplate` / `renderTemplateAsHtmlString` / `withTemplates(path, fn)`. Cross-shell shared modules must **not** call bare `usingTemplates` (process-level singleton redirects template root) — use `withTemplates` or direct DOM.
- **`dialog.mjs`**: `openDialogFromTemplate` / `pickFromDialog`. Templates supply `modal-box` (+ optional `modal-backdrop`) only — do not nest another `<dialog>`.
- **`contentReveal/`**: `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang`.
- **`memo.mjs`**: `memoizePromise` / `createLruMap`.
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## Rendering & Content

- **`lib/escapeHtml.mjs`**: escape `& < > " '` via string replace. Do **not** use `textContent`/`innerHTML` round-trip — it leaves `"` unescaped and breaks attributes.
- **`markdown.mjs`**: Markdown → HTML (KaTeX, Mermaid, Shiki). Extensions via `markdown_extensions` registry into `GetMarkdownConvertor`. Shells use only `getConvertor` / `renderMarkdownAsString` with `allowDangerousHtml`:
  - **trusted**: full HTML; `languageExecutors` may override `safeLanguageExecutors`
  - **safe**: early sanitize + Mermaid strict + `safeLanguageExecutors` only
  Both executor maps live in `convertor.mjs` (same language may have both implementations). Do not wrap another shell-specific convertor on top.
- **Code block UI**: copy/download/execute as a rehype plugin **after** `rehype-pretty-code` (only `figure[data-rehype-pretty-code-figure] > pre`). Do not use Shiki `transformers.root` wrapping — breaks inline `{:lang}` (`root>pre` expected). Plain `` `code` `` stays bare `<code>`; `` `code{:js}` `` → `span>code`. HTML `document.write` preview is trusted-only.
- **`sanitizeHtml.mjs`**: `sanitizePermissiveHtml` — rich displayName HTML minus script / `on*` / dangerous URLs. `isSafeHtmlUrl` (Markdown sanitize + mediaRefs) rejects `javascript:` / `data:` and protocol-relative `//…`.
- **`embedCard.mjs`**: `ALL /api/no-cors?url=` + OG parse; `MutationObserver` hydration; session LRU.
- **`/api/no-cors`**: authenticated streaming proxy. Forwards Range / conditional / Content-Type; inject upstream Cookie/Authorization via `No-Cors-*` prefix. `X-No-Cors-Final-Url` after redirects.
- **`markdownExtensions.mjs`**: Loads `markdown_extensions` registry.
- **`registries.mjs`**: `GET /api/registries/:name` + dynamic `import()`.
- **`emojiPicker.mjs`** / **`stickerPicker.mjs`**: Shared pickers; Hub mounts via `mountDockedEmojiPicker` / `mountDockedStickerPicker`. Option names: `pickerElement`, `gridElement`, `triggerButton`, … (full words). Leave DaisyUI class names alone.
- **`svgInliner.mjs`**: Inline SVGs for `currentColor`.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. `data-i18n`, `geti18n`, `setElementI18n`, preferred langs.
- **`data-i18n` params**: full `element.dataset` is the interpolation map. Templates: `data-i18n="foo.bar" data-n="3"`. JS: `setElementI18n(el, 'foo.bar', { n: 3 })` — MutationObserver watches **only** `data-i18n`. Nested keys: `placeholder` / `title` / `aria-label` / `textContent` / `innerHTML` / `dataset`. **`input`/`textarea` placeholders must use an object key** (`{ "placeholder": "…" }`); a string key writes `innerHTML` and wipes textarea input. Do not use i18n key switching for disabled states.
- **`i18n_base.mjs`**: Internal — `userPreferredLanguages` vs `fountUserPreferredLanguages` (GitHub Pages).

## Components & Utilities

- **`virtualList.mjs`**: Virtual scrolling. Optional `getItemKey` enables keyed reconcile on `refresh()`.
- **`infiniteScroll.mjs`**: `ensureScrollSentinel` / `bindInfiniteScroll` / `disconnectInfiniteScroll`. Rising-edge arm; after replay move the sentinel, do not rebind while intersecting.
- **`search.mjs`**: Live filtering and searchable dropdowns.
- **`jsonEditor.mjs`**: `vanilla-jsoneditor` wrapper.
- **`terminal.mjs`**: `xterm.js` wrapper.
- **`regex.mjs`**: Regex parsing and escaping.
- **`lib/base64.mjs`**: `arrayBufferToBase64` / `blobToBase64` — reuse for upload bodies; do not copy per shell.
- **`credentialManager.mjs`**: Secure credential encryption and transfer.

## P2P (Browser)

Import via `esm.sh`. Shared primitives live in `shells/chat/public/shared/` (`/parts/shells:chat/shared/…`). Entity HTTP: `/api/parts/shells:chat/{viewer,entities…}`; network: `/api/p2p/{network,denylist,mailbox,federation}`.
