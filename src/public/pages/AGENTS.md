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
- **`template.mjs`**: `renderTemplate(name, data)` / `mountTemplate(parent, name, data)` / `renderTemplateAsHtmlString` / `withTemplates(path, fn)`（临时切换模板根并自动恢复；跨壳共享模块禁止裸调 `usingTemplates`，以免污染调用方路径）。
- **`dialog.mjs`**: `openDialogFromTemplate(templateName, data, { onReady })` and `pickFromDialog` for `<dialog class="modal">` lifecycle.
- **`contentReveal/`** (`index.mjs`): `wrapSensitiveMediaHtml`, `wrapContentWarningHtml`, `bindContentReveal` — content warning / sensitive media fold and reveal delegation; auto-injects `contentReveal.css`.
- **`translate.mjs`**: `mountTranslationBlock`, `requestTranslation`, `resolveTargetLang` — translation block mount/switch and translation API requests.
- **`memo.mjs`**: `memoizePromise` / `createLruMap`.
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## Rendering & Content

- **`lib/escapeHtml.mjs`**: must escape `& < > " '` (string replace). Do **not** use `textContent`/`innerHTML` round-trip — it leaves `"` unescaped and will break attribute values (`data-*="…"`).
- **`markdown.mjs`**: Markdown → HTML with KaTeX, Mermaid, Shiki. Non-standalone pipeline tags bare `http(s)` links with `data-fount-embed` (a whole-line link = `card`, inline = `chip`; `[text](url)` is ignored).
- **`embedCard.mjs`**: Fetches pages via `ALL /api/no-cors?url=` + `DOMParser` OG parsing, hydrated by `MutationObserver` on placeholder links; session-level LRU cache.
- **`/api/no-cors`** (server): authenticated bidirectional streaming proxy. Forwards `Range` / conditional / `Content-Type` headers by name; upstream Cookie, Authorization, and custom headers injected via `No-Cors-*` prefix (e.g. `No-Cors-Authorization: Bearer …` → `Authorization`). Does not buffer the full body; `X-No-Cors-Final-Url` records the final URL after redirects.
- **`markdownExtensions.mjs`**: Loads `markdown_extensions` registry (remark/rehype plugins, CSS, init hooks).
- **`registries.mjs`**: `GET /api/registries/:name` + dynamic `import()` of registry modules.
- **`emojiPicker.mjs`** / **`stickerPicker.mjs`**: Shared pickers consuming `emoji`/`sticker` registries; Hub mounts via `mountDockedEmojiPicker`/`mountDockedStickerPicker`. Docked options use full names: `pickerElement`, `gridElement`, `triggerButton`, `tabsElement`, `inputElement` — not `*El`/`*Btn`. **JS variable names, HTML `id`s, and i18n keys** use full words (`*Button`/`*Element`/`*Context`); leave external UI-library classes (e.g. DaisyUI's `class="btn …"`) untouched.
- **`svgInliner.mjs`**: Inlines SVGs for CSS `currentColor` styling.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. `data-i18n` attributes, `geti18n`, `setElementI18n`, `loadPreferredLangs`, `savePreferredLangs`.
- **`data-i18n` / `dataset.i18n` 传参**：`translateSingularElement` 把整份 `element.dataset` 当作 `geti18n(key, params)` 的插值表。模板里写 `data-i18n="foo.bar" data-n="3"`（locale 用 `${n}`）；JS 动态更新用 `setElementI18n(el, 'foo.bar', { n: 3 })`——MutationObserver **只**监听 `data-i18n`，同键改参不会自动重译。嵌套对象键可写 `placeholder` / `title` / `aria-label` / `textContent` / `innerHTML` / `dataset`。`geti18n` 仍用于无 DOM 场景（`prompt`/`confirm`/`Error` 文案）或文案中间嵌入已构造的 DOM/HTML 片段。
- **`i18n_base.mjs`**: Internal (imported only by `i18n.mjs`): `userPreferredLanguages` (host app) vs `fountUserPreferredLanguages` (static GitHub Pages).

## Components & Utilities

- **`virtualList.mjs`**: High-performance virtual scrolling. Optional `getItemKey(item)` enables keyed reconcile on `refresh()` (reuse unchanged DOM by key + `JSON.stringify` equality; preserve scroll after first paint) — prefer this over `innerHTML = ''` for chat-style feeds.
- **`infiniteScroll.mjs`**: `IntersectionObserver`-based pagination: `ensureScrollSentinel` places sentinel (`overflow-anchor: none`), `bindInfiniteScroll` calls `onLoad` as the bottom approaches (in-flight lock + rising-edge arm: one fire per enter-intersection, leave to re-arm); use `disconnectInfiniteScroll` when switching views (single global observer). Pagination chains by rebinding after each page; after replay prefer moving the sentinel over rebinding.
- **`search.mjs`**: Live filtering and searchable dropdowns.
- **`jsonEditor.mjs`**: `vanilla-jsoneditor` wrapper.
- **`terminal.mjs`**: `xterm.js` terminal wrapper.
- **`regex.mjs`**: Regex parsing and escaping.
- **`credentialManager.mjs`**: Secure credential encryption and transfer.

## P2P (Browser)

Import via `esm.sh`. Shared primitives (`entityHash`, `digest`, `mentions`, `inlineTokens`, `hashAvatar`, `evfsMedia`, etc.) live in `shells/chat/public/shared/` (served at `/parts/shells:chat/shared/…`). Entity HTTP surface: `/api/parts/shells:chat/{viewer,entities…}`; node network surface: `/api/p2p/{network,denylist,mailbox,federation}`.
