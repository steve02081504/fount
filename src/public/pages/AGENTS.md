# Frontend Common Functions Guide

**Location**: `@src/public/pages/scripts/`
**Note**: Consult these scripts before implementing new frontend logic to ensure consistency and reuse.

## 1. API & Communication

- **`endpoints.mjs`**: Core auth and system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`debug_log.mjs`**: `debugLog(name, data)` → `debug_logs/` (see root [AGENTS.md](../../../AGENTS.md)).
- **`parts.mjs`**: Part management (`runPart`, `loadPart`, `getPartList`, `setDefaultPart`).
- **`server_events.mjs`**: Event bus for server-sent events (`onServerEvent`).

## 2. UI & Theming

- **`theme.mjs`**: DaisyUI theme management. Always call `applyTheme()` first.
- **`template.mjs`**: HTML templating with i18n support. Use `renderTemplate(name, data)` and `parent.appendChild(await renderTemplate(...))` to append; `mountTemplate(parent, name, data)` to replace a container; `renderTemplateAsHtmlString` for HTML fragments.
- **`dialog.mjs`**: `openDialogFromTemplate(templateName, data, { onReady })` and `pickFromDialog` for `<dialog class="modal">` lifecycle.
- **`memo.mjs`**: `memoizePromise` / `createLruMap` for browser-side dedupe caches.
- **`toast.mjs`**: Notifications (`showToast`, `showToastI18n`).
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## 3. Rendering & Content

- **`markdown.mjs`**: Markdown to HTML with KaTeX, Mermaid, and Shiki support.
- **`markdownExtensions.mjs`**: Loads `markdown_extensions` registry modules (remark/rehype plugins, CSS, init hooks).
- **`registries.mjs`**: Frontend helper for `GET /api/registries/:name` and dynamic `import()` of registry modules.
- **`emojiPicker.mjs`** / **`stickerPicker.mjs`**: Shared docked/floating pickers consuming `emoji` / `sticker` registries; Chat Hub mounts via `mountDockedEmojiPicker` / `mountDockedStickerPicker`.
- **`svgInliner.mjs`**: Inlines SVGs to allow CSS styling (`currentColor`).
- **`i18n.mjs`**: Sole public entry point. Call `initTranslations()` early on each page. Use `data-i18n` attributes and APIs such as `geti18n`, `loadPreferredLangs`, and `savePreferredLangs`.
- **`i18n_base.mjs`**: Internal implementation (imported only by `i18n.mjs`): loads locale bundles per environment. Host app uses `userPreferredLanguages`; static GitHub Pages use a separate `i18n_base.mjs` with `fountUserPreferredLanguages`.

## 4. Components & Utilities

- **`virtualList.mjs`**: High-performance virtual scrolling for large lists.
- **`search.mjs`**: Live filtering and searchable dropdowns.
- **`jsonEditor.mjs`**: `vanilla-jsoneditor` wrapper.
- **`terminal.mjs`**: `xterm.js` terminal wrapper.
- **`regex.mjs`**: Regex parsing and escaping.
- **`credentialManager.mjs`**: Secure credential encryption and transfer.

**See also**: [Root AGENTS.md](../../../AGENTS.md) for architecture overview.
