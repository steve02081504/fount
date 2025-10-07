# AI Agent Guide: Frontend Common Functions

**Objective**: This document provides a comprehensive list of shared, reusable JavaScript helper functions located in `@src/pages/scripts/`.

**Instruction**: Before implementing any new frontend functionality, **you must consult this guide**. Reusing these functions is critical for maintaining application consistency, reducing code duplication, and ensuring stability.

---

## 1. API Communication

### 1.1. Core Backend API (`endpoints.mjs`)

- **Purpose**: Functions for core user authentication and system interaction.
- `async whoami()`: Retrieves the current user's identity.
- `async login(username, password, deviceid)`: Authenticates a user.
- `async logout()`: Logs out the current user.
- `async runPart(parttype, partname, args)`: Executes a "part" on the server.
- `async getApiKeys()`: Retrieves the user's API keys.
- `async createApiKey(description)`: Creates a new API key.
- `async revokeApiKey(jti)`: Revokes an API key.
- `async verifyApiKey(apiKey)`: Verifies an API key.

### 1.2. "Part" Interaction API (`parts.mjs`)

- **Purpose**: Functions for fetching and managing fount "parts" (e.g., characters, worlds).
- `async getPartTypes()`: Retrieves a list of all available part types.
- `async getPartList(partType)`: Retrieves a list of all available parts of a specified type (e.g., 'chars').
- `async getPartDetails(partType, partName)`: Fetches detailed information for a specific part.
- `async getCharDetails(charname)`: Fetches detailed information for a specific character. (Similar functions exist for `worlds` and `personas`).
- `async getAllCachedPartDetails(partType)`: Fetches all cached details for a given part type.
- `async setDefaultPart(parttype, partname)`: Sets the user's default part for a given type.
- `async getDefaultParts()`: Gets all of the user's default parts.

### 1.3. Home Shell API (`@src/public/shells/home/src/public/endpoints.mjs`)

- `async getHomeRegistry()`: Fetches the registry that defines what buttons and part interfaces appear on the Home shell.

---

## 2. Theming & Styling

### 2.1. Global Theme Management (`theme.mjs`)

- **Purpose**: Manages the application's visual theme using `daisyUI`.
- `applyTheme()`: **Call this first** in any new page's main script to initialize the theme.
- `onThemeChange(callback)`: Registers a callback that fires whenever the theme (including light/dark mode) changes. Use this to dynamically update UI components.
- `setTheme(theme)`: Sets the application theme (e.g., 'dark', 'light', 'auto').

### 2.2. Dynamic CSS (`cssValues.mjs`)

- **Purpose**: Manipulate CSS custom properties (variables) directly.
- `setCssVariable(name, value)`: Sets a CSS variable on the root element.
- `registerCssUpdater(func)`: Registers a function that runs immediately and on window resize, ideal for responsive calculations.

---

## 3. DOM & Rendering

### 3.1. Templating Engine (`template.mjs`)

- **Purpose**: A powerful engine for rendering HTML from templates.
- `usingTemplates(path)`: Sets the base path for your template files (e.g., `/shells/chat/src/public/templates`).
- `async renderTemplate(templateName, data)`: Fetches an `.html` template, injects the `data` object, and returns a rendered DOM element. **This is the primary method for creating complex UI elements.** It automatically translates any `data-i18n` attributes within the template, so you do not need to call `i18nElement` on the result.
- `createDocumentFragmentFromHtmlString(htmlString)`: Safely creates a DOM fragment from a raw HTML string, correctly handling `<script>` and `<link>` tags.

### 3.2. Markdown Rendering (`markdown.mjs`)

- **Purpose**: Renders Markdown text into styled HTML.
- `async renderMarkdown(markdown)`: Converts a Markdown string into a DOM element with full support for code highlighting (rehype-pretty-code), math formulas (KaTeX), and diagrams (Mermaid).

### 3.3. SVG Handling (`svgInliner.mjs`)

- **Purpose**: Replaces `<img>` tags pointing to `.svg` files with inline `<svg>` elements. This is **essential** for allowing SVGs to inherit color via the CSS `currentColor` property.
- `async svgInliner(DOM)`: Processes a DOM element to inline all SVG images within it.

---

## 4. Internationalization (i18n)

### `i18n.mjs`

- **Purpose**: Handles all multi-language text translation.
- `async initTranslations(pageid)`: **Call this early** in your page script. It fetches the language data for the specified page.
- `geti18n(key, params)`: Retrieves the translated string for a given key (e.g., `home.title`). Supports interpolation with `params`.
- `i18nElement(element)`: **Use this after rendering new content** that was not created by `renderTemplate`. It automatically translates all descendant elements that have a `data-i18n` attribute. The `renderTemplate` function handles this automatically.

---

## 5. UI Components

### `jsonEditor.mjs`

- `createJsonEditor(container, options)`: Creates a full-featured `vanilla-jsoneditor` instance inside the specified `container` element.

### `terminal.mjs`

- `setTerminal(element)`: Creates a themed, functional `xterm.js` terminal instance inside the specified `element`.
