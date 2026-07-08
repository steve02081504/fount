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
- **`template.mjs`**: `renderTemplate(name, data)` / `mountTemplate(parent, name, data)` / `renderTemplateAsHtmlString`.
- **`dialog.mjs`**: `openDialogFromTemplate(templateName, data, { onReady })` and `pickFromDialog` for `<dialog class="modal">` lifecycle.
- **`memo.mjs`**: `memoizePromise` / `createLruMap`.
- **`toast.mjs`**: `showToast`, `showToastI18n`.
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## Rendering & Content

- **`markdown.mjs`**: Markdown → HTML with KaTeX, Mermaid, Shiki.
- **`markdownExtensions.mjs`**: Loads `markdown_extensions` registry (remark/rehype plugins, CSS, init hooks).
- **`registries.mjs`**: `GET /api/registries/:name` + dynamic `import()` of registry modules.
- **`emojiPicker.mjs`** / **`stickerPicker.mjs`**: Shared pickers consuming `emoji`/`sticker` registries; Hub mounts via `mountDockedEmojiPicker`/`mountDockedStickerPicker`. Docked options use full names: `pickerElement`, `gridElement`, `triggerButton`, `tabsElement`, `inputElement` — not `*El`/`*Btn`. **JS variable names, HTML `id`s, and i18n keys** use full words (`*Button`/`*Element`/`*Context`); leave external UI-library classes (e.g. DaisyUI's `class="btn …"`) untouched.
- **`svgInliner.mjs`**: Inlines SVGs for CSS `currentColor` styling.
- **`i18n.mjs`**: Sole public entry. Call `initTranslations()` early. `data-i18n` attributes, `geti18n`, `loadPreferredLangs`, `savePreferredLangs`.
- **`i18n_base.mjs`**: Internal (imported only by `i18n.mjs`): `userPreferredLanguages` (host app) vs `fountUserPreferredLanguages` (static GitHub Pages).

## Components & Utilities

- **`virtualList.mjs`**: High-performance virtual scrolling.
- **`search.mjs`**: Live filtering and searchable dropdowns.
- **`jsonEditor.mjs`**: `vanilla-jsoneditor` wrapper.
- **`terminal.mjs`**: `xterm.js` terminal wrapper.
- **`regex.mjs`**: Regex parsing and escaping.
- **`credentialManager.mjs`**: Secure credential encryption and transfer.
- **`lib/digest.mjs`**: Cross-runtime SHA-256 helpers (Deno + browser).
