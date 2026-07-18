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
- **`template.mjs`**: `renderTemplate(name, data)` / `mountTemplate(parent, name, data)` / `renderTemplateAsHtmlString` / `withTemplates(path, fn)` (temporarily switch template root and auto-restore; cross-shell shared modules must NOT call bare `usingTemplates` — it is a process-level singleton that redirects template requests to the caller's path; use `withTemplates` or direct DOM instead).
- **`dialog.mjs`**: `openDialogFromTemplate(templateName, data, { onReady })` and `pickFromDialog` for `<dialog class="modal">` lifecycle. Templates supply `modal-box` (+ optional `modal-backdrop`) only — do **not** wrap another `<dialog>` (nested modal locks the page with invisible content).
- **`contentReveal/`** (`index.mjs`): `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal` — content warning / sensitive media fold and reveal delegation; auto-injects `contentReveal.css`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang` — translation block mount/switch and translation API requests.
- **`memo.mjs`**: `memoizePromise` / `createLruMap`.
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## Rendering & Content

- **`lib/escapeHtml.mjs`**: must escape `& < > " '` (string replace). Do **not** use `textContent`/`innerHTML` round-trip — it leaves `"` unescaped and will break attribute values (`data-*="…"`).
- **`markdown.mjs`**: Markdown → HTML with KaTeX, Mermaid, Shiki. Chat/social extensions are registered via `markdown_extensions` registry into `GetMarkdownConvertor`. Shell code uses only `getConvertor` / `renderMarkdownAsString` with `allowDangerousHtml` for two tiers — **trusted** (full HTML + `languageExecutors` 覆盖 `safeLanguageExecutors`) and **safe** (early sanitize + Mermaid strict + 只用 `safeLanguageExecutors`). 两套执行器在 `convertor.mjs`；同语言可各给一个实现，因地制宜。Do not wrap another shell-specific convertor on top.
- **Code block enhancements**: copy/download/execute UI must be added as a rehype plugin **after** `rehype-pretty-code` (touching only `figure[data-rehype-pretty-code-figure] > pre`). Do not use Shiki `transformers.root` wrapping — it breaks the inline `{:lang}` path (expects `root>pre`; wrapping emits block `<pre>`). Plain `` `code` `` stays as bare `<code>`; `` `code{:js}` `` becomes `span>code`. Untrusted tier only resolves `safeLanguageExecutors` (sql/cpp/…); trusted may override with `languageExecutors` (js/py/…). HTML `document.write` preview remains trusted-only.
- **`sanitizeHtml.mjs`**: `sanitizePermissiveHtml` — allow rich displayName HTML but strip script / `on*` / dangerous URLs (same tag/URL rules as Markdown untrusted sanitize).
- **`embedCard.mjs`**: Fetches pages via `ALL /api/no-cors?url=` + `DOMParser` OG parsing, hydrated by `MutationObserver` on placeholder links; session-level LRU cache.
- **`/api/no-cors`** (server): authenticated bidirectional streaming proxy. Forwards `Range` / conditional / `Content-Type` headers by name; upstream Cookie, Authorization, and custom headers injected via `No-Cors-*` prefix (e.g. `No-Cors-Authorization: Bearer …` → `Authorization`). Does not buffer the full body; `X-No-Cors-Final-Url` records the final URL after redirects.
- **`markdownExtensions.mjs`**: Loads `markdown_extensions` registry (remark/rehype plugins, CSS, init hooks).
- **`registries.mjs`**: `GET /api/registries/:name` + dynamic `import()` of registry modules.
- **`emojiPicker.mjs`** / **`stickerPicker.mjs`**: Shared pickers consuming `emoji`/`sticker` registries; Hub mounts via `mountDockedEmojiPicker`/`mountDockedStickerPicker`. Docked options use full names: `pickerElement`, `gridElement`, `triggerButton`, `tabsElement`, `inputElement` — not `*El`/`*Btn`. **JS variable names, HTML `id`s, and i18n keys** use full words (`*Button`/`*Element`/`*Context`); leave external UI-library classes (e.g. DaisyUI's `class="btn …"`) untouched.
- **`svgInliner.mjs`**: Inlines SVGs for CSS `currentColor` styling.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. `data-i18n` attributes, `geti18n`, `setElementI18n`, `loadPreferredLangs`, `savePreferredLangs`.
- **`data-i18n` / `dataset.i18n` params**: `translateSingularElement` passes the full `element.dataset` as the `geti18n(key, params)` interpolation map. In templates: `data-i18n="foo.bar" data-n="3"` (locale uses `${n}`); for JS dynamic updates: `setElementI18n(el, 'foo.bar', { n: 3 })` — MutationObserver watches **only** `data-i18n`, so same-key param changes do not auto-retranslate. Nested object keys: `placeholder` / `title` / `aria-label` / `textContent` / `innerHTML` / `dataset`. **`input`/`textarea` placeholders must use an object key** (`{ "placeholder": "…" }`); a string key writes `innerHTML`, causing `textarea` to lose user input. Do not use i18n key switching to express disabled states. `geti18n` is appropriate for non-DOM contexts (`prompt`/`confirm`/`Error` messages) or embedding already-constructed DOM/HTML fragments inline.
- **`i18n_base.mjs`**: Internal (imported only by `i18n.mjs`): `userPreferredLanguages` (host app) vs `fountUserPreferredLanguages` (static GitHub Pages).

## Components & Utilities

- **`virtualList.mjs`**: High-performance virtual scrolling. Optional `getItemKey(item)` enables keyed reconcile on `refresh()` (reuse unchanged DOM by key + `JSON.stringify` equality; preserve scroll after first paint) — prefer this over `innerHTML = ''` for chat-style feeds.
- **`infiniteScroll.mjs`**: `IntersectionObserver`-based pagination: `ensureScrollSentinel` places sentinel (`overflow-anchor: none`), `bindInfiniteScroll` calls `onLoad` as the bottom approaches (in-flight lock + rising-edge arm: one fire per enter-intersection, leave to re-arm); use `disconnectInfiniteScroll` when switching views (single global observer). Pagination chains by rebinding after each page; after replay prefer moving the sentinel over rebinding.
- **`search.mjs`**: Live filtering and searchable dropdowns.
- **`jsonEditor.mjs`**: `vanilla-jsoneditor` wrapper.
- **`terminal.mjs`**: `xterm.js` terminal wrapper.
- **`regex.mjs`**: Regex parsing and escaping.
- **`lib/base64.mjs`**: `arrayBufferToBase64` / `blobToBase64`（上传 body 等；勿在各壳再抄一份）。
- **`credentialManager.mjs`**: Secure credential encryption and transfer.

## P2P (Browser)

Import via `esm.sh`. Shared primitives (`entityHash`, `digest`, `mentions`, `inlineTokens`, `hashAvatar`, `evfsMedia`, etc.) live in `shells/chat/public/shared/` (served at `/parts/shells:chat/shared/…`). Entity HTTP surface: `/api/parts/shells:chat/{viewer,entities…}`; node network surface: `/api/p2p/{network,denylist,mailbox,federation}`.
