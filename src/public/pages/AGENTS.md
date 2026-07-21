---
description: Frontend shared page utilities (API, i18n, theming, templates, markdown)
globs: src/public/pages/**
alwaysApply: false
---

# Frontend Common Functions Guide

**Location**: `@src/public/pages/scripts/` — consult before implementing new frontend logic.

Markdown convertor traps (rehype order, `{:lang}`, trust tiers): [markdown-notes.md](markdown-notes.md).

## API & Communication

- **`endpoints.mjs`**: Core auth/system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`debug_log.mjs`**: `debugLog(name, data)` → `debug_logs/`.
- **`parts.mjs`**: `runPart`, `loadPart`, `getPartList`, `setDefaultPart`.
- **`server_events.mjs`**: `onServerEvent` — server-sent event bus.

## UI & Theming

- **`theme.mjs`**: DaisyUI theme management. Call `applyTheme()` first.
- **`template.mjs`**: `renderTemplate` / `mountTemplate` / `renderTemplateAsHtmlString` / `withTemplates(path, fn)`. Cross-shell shared modules must **not** call bare `usingTemplates` — use `withTemplates` or direct DOM.
- **`dialog.mjs`**: `openDialogFromTemplate` / `pickFromDialog`. Templates supply `modal-box` (+ optional `modal-backdrop`) only — do not nest another `<dialog>`.
- **`contentReveal/`**: `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang`（→ `primaryLocale()`）。
- **`memo.mjs`**: `memoizePromise` / `createLruMap`.
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## Rendering & Content

- **`lib/escapeHtml.mjs`**: escape `& < > " '` via string replace. Do **not** use `textContent`/`innerHTML` round-trip — leaves `"` unescaped.
- **`markdown.mjs`**: Markdown → HTML (KaTeX, Mermaid, Shiki). Shells use `getConvertor` / `renderMarkdownAsString` with `allowDangerousHtml`. Details: [markdown-notes.md](markdown-notes.md).
- **`markdown/standaloneDocument.mjs`**: `renderMarkdownAsStandaloneDocument` / `wrapStandaloneMarkdownDocument` — offline full HTML (OG, DaisyUI, github-markdown-css, attachment data URLs). Shared by Chat message download/share/drag and Social post “Download HTML”; do not export bare Markdown fragments alone.
- **`sanitizeHtml.mjs`**: `sanitizePermissiveHtml` — rich displayName HTML minus script / `on*` / dangerous URLs. `isSafeHtmlUrl` rejects `javascript:` / `data:` / protocol-relative `//…`.
- **`embedCard.mjs`**: `ALL /api/no-cors?url=` + OG parse; `MutationObserver` hydration; session LRU.
- **`/api/no-cors`**: authenticated streaming proxy. Forwards Range / conditional / Content-Type; inject upstream Cookie/Authorization via `No-Cors-*` prefix. `X-No-Cors-Final-Url` after redirects.
- **`markdownExtensions.mjs`**: Loads `markdown_extensions` registry.
- **`registries.mjs`**: `GET /api/registries/:name` + dynamic `import()`.
- **`emojiPicker.mjs`** / **`stickerPicker.mjs`**: Shared pickers; Hub mounts via `mountDockedEmojiPicker` / `mountDockedStickerPicker`. Option names: full words (`pickerElement`, `gridElement`, …). Leave DaisyUI class names alone.
- **`svgInliner.mjs`**: Inline SVGs for `currentColor`.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. `data-i18n`, `geti18n`, `setElementI18n`, `primaryLocale()` (preferredLangs[0] → `main_locale`, default `en-UK`). Use it for content locale / translation target — do not hardcode `zh-CN` or bare `navigator.language`.
- **`data-i18n` params**: full `element.dataset` is the interpolation map. MutationObserver watches **only** `data-i18n`. Nested attribute keys: `placeholder` / `title` / `label` / `value` / `alt` / `aria-label` / `textContent` / `innerHTML` / `dataset`. **`input`/`textarea` placeholders must use an object key** (`{ "placeholder": "…" }`); a string key writes `innerHTML` and wipes textarea input. Do **not** name keys `fooPlaceholder` / `fooAlt` — use `foo: { placeholder|alt: "…" }` and point `data-i18n` at `foo`. No `data-i18n-attr`.
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
