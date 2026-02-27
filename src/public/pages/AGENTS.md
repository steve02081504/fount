# Frontend Common Functions Guide

**Location**: `@src/public/pages/scripts/`
**Note**: Consult these scripts before implementing new frontend logic to ensure consistency and reuse.

## 1. API & Communication

- **`endpoints.mjs`**: Core auth and system APIs (`login`, `register`, `whoami`, `getUserSetting`, etc.).
- **`parts.mjs`**: Part management (`runPart`, `loadPart`, `getPartList`, `setDefaultPart`).
- **`server_events.mjs`**: Event bus for server-sent events (`onServerEvent`).

## 2. UI & Theming

- **`theme.mjs`**: DaisyUI theme management. Always call `applyTheme()` first.
- **`template.mjs`**: HTML templating with i18n support. Use `renderTemplate(name, data)`.
- **`toast.mjs`**: Notifications (`showToast`, `showToastI18n`).
- **`cssValues.mjs`**: Dynamic CSS variable manipulation.

## 3. Rendering & Content

- **`markdown.mjs`**: Markdown to HTML with KaTeX, Mermaid, and Shiki support.
- **`svgInliner.mjs`**: Inlines SVGs to allow CSS styling (`currentColor`).
- **`i18n.mjs`**: Full translation support. Call `initTranslations()` early. Use `data-i18n` attributes.

## 4. Components & Utilities

- **`virtualList.mjs`**: High-performance virtual scrolling for large lists.
- **`search.mjs`**: Live filtering and searchable dropdowns.
- **`jsonEditor.mjs`**: `vanilla-jsoneditor` wrapper.
- **`terminal.mjs`**: `xterm.js` terminal wrapper.
- **`regex.mjs`**: Regex parsing and escaping.
- **`credentialManager.mjs`**: Secure credential encryption and transfer.

**See also**: [Root AGENTS.md](../../../AGENTS.md) for architecture overview.
