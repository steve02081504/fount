# AI Agent Guide: Frontend Common Functions

**Objective**: This document provides a comprehensive list of shared, reusable
JavaScript helper functions located in `@src/public/pages/scripts/`.

**Instruction**: Before implementing any new frontend functionality, **you must
consult this guide**. Reusing these functions is critical for maintaining
application consistency, reducing code duplication, and ensuring stability.

**See also**: [fount Architecture & AI Agent Prompting Guide](../../../AGENTS.md) (root); [Shell Architecture & Creation Guide](../parts/shells/AGENTS.md) for Shell-specific frontend/backend patterns.

---

## 1. API Communication

### 1.1. Core Backend API (`endpoints.mjs`)

- **Purpose**: Functions for core user authentication and system interaction.
- `async ping(with_cache)`: Pings the server.
- `async hosturl_in_local_ip()`: Gets the host URL in the local IP network.
- `async getPoWChallenge()`: Gets a Proof-of-Work challenge.
- `async redeemPoWToken(token, solutions)`: Redeems a PoW token.
- `async getLocaleData(preferred)`: Gets locale data for preferred languages.
- `async getAvailableLocales()`: Gets a list of available locales.
- `async generateVerificationCode()`: Generates a registration verification code.
- `async whoami()`: Retrieves the current user's identity.
- `async login(username, password, deviceid, powToken)`: Authenticates a user.
- `async register(username, password, deviceid, verificationcode, powToken)`: Registers a new user.
- `async authenticate()`: Verifies the current session.
- `async getUserSetting(key)`: Gets a specific user setting.
- `async setUserSetting(key, value)`: Sets a specific user setting.
- `async logout()`: Logs out the current user.
- `async getApiKeys()`: Retrieves the user's API keys.
- `async createApiKey(description)`: Creates a new API key.
- `async revokeApiKey(jti, password)`: Revokes an API key.
- `async verifyApiKey(apiKey)`: Verifies an API key.
- `async getApiCookie(apiKey)`: Gets a session cookie using an API key.

### 1.2. "Part" Interaction API (`parts.mjs`)

- **Purpose**: Functions for fetching and managing fount "parts" (e.g.,
  characters, worlds).
- `async runPart(partpath, args)`: Executes a "part" on the server.
- `async loadPart(partpath)`: Loads a part.
- `async getPartTypeList()`: Retrieves a list of all available part types.
- `async getPartList(path)`: Retrieves a list of all available parts at a
  specified path (e.g., 'chars').
- `async getLoadedPartList(path)`: Retrieves a list of already loaded parts at a
  specified path.
- `async getPartDetails(path, nocache)`: Fetches detailed information for a
  specific part (e.g., 'chars/my-char').
- `async getAllCachedPartDetails(path)`: Fetches all cached details for a
  given path.
- `async setDefaultPart(parent, child)`: Sets the user's default part for a
  given parent.
- `async unsetDefaultPart(parent, child)`: Unsets a default part.
- `async getAllDefaultParts()`: Gets all of the user's default parts.
- `async getAnyDefaultPart(parent)`: Gets any single default part for a parent.
- `async getAllDefaultPartsByType(parent)`: Gets all default parts for a parent.
- `async getAnyPreferredDefaultPart(parent)`: Gets a preferred default part for a parent.
- `async getPartBranches(nocache)`: Gets the part branch tree.
- `async unlockAchievement(partpath, achievementId)`: Unlocks an achievement for a part.

### 1.3. Home Shell API (`@src/public/parts/shells/home/public/src/endpoints.mjs`)

- `async getHomeRegistry()`: Fetches the registry that defines what buttons and
  part interfaces appear on the Home shell.

### 1.4. Server Events (`server_events.mjs`)

- **Purpose**: A simple event bus for handling server-sent events.
- `onServerEvent(type, callback)`: Registers a callback for a specific event
  type.
- `offServerEvent(type, callback)`: Unregisters a callback for a specific event
  type.

---

## 2. Theming & Styling

### 2.1. Global Theme Management (`theme.mjs`)

- **Purpose**: Manages the application's visual theme using `daisyUI`.
- `applyTheme()`: **Call this first** in any new page's main script to
  initialize the theme.
- `onThemeChange(callback)`: Registers a callback that fires whenever the theme
  (including light/dark mode) changes. Use this to dynamically update UI
  components.
- `setTheme(theme)`: Sets the application theme (e.g., 'dark', 'light', 'auto').

### 2.2. Dynamic CSS (`cssValues.mjs`)

- **Purpose**: Manipulate CSS custom properties (variables) directly.
- `setCssVariable(name, value)`: Sets a CSS variable on the root element.
- `registerCssUpdater(func)`: Registers a function that runs immediately and on
  window resize, ideal for responsive calculations.

---

## 3. DOM & Rendering

### 3.1. Templating Engine (`template.mjs`)

- **Purpose**: A powerful engine for rendering HTML from templates.
- `usingTemplates(path)`: Sets the base path for your template files (e.g.,
  `/parts/shells/chat/src/public/templates`).
- `async renderTemplate(templateName, data)`: Fetches an `.html` template,
  injects the `data` object, and returns a rendered DOM element. **This is the
  primary method for creating complex UI elements.** It automatically translates
  any `data-i18n` attributes within the template, so you do not need to call
  `i18nElement` on the result.
- `createDocumentFragmentFromHtmlString(htmlString)`: Safely creates a DOM
  fragment from a raw HTML string, correctly handling `<script>` and `<link>`
  tags.

### 3.2. Markdown Rendering

#### `markdown.mjs`

- **Purpose**: Renders Markdown text into styled HTML.
- `async renderMarkdown(markdown)`: Converts a Markdown string into a DOM
  element with full support for code highlighting (rehype-pretty-code), math
  formulas (KaTeX), and diagrams (Mermaid).

#### `markdownConvertor.mjs`

- **Purpose**: Advanced Markdown processing using `unified`, `remark`, and
  `rehype`. Used internally by `markdown.mjs` but can be used directly for custom pipelines.
- `async GetMarkdownConvertor({ isStandalone })`: Returns a `unified` processor
  configured with plugins for GFM, math (KaTeX), diagrams (Mermaid), and code
  highlighting (Shiki). It adds interactive buttons (copy, download, preview,
  execute) to code blocks.

### 3.3. SVG Handling (`svgInliner.mjs`)

- **Purpose**: Replaces `<img>` tags pointing to `.svg` files with inline
  `<svg>` elements. This is **essential** for allowing SVGs to inherit color via
  the CSS `currentColor` property.
- `async svgInliner(DOM)`: Processes a DOM element to inline all SVG images
  within it.

### 3.4. Element Removal Hook (`onElementRemoved.mjs`)

- **Purpose**: A utility function that triggers a callback when a DOM element is
  removed from the document.
- `onElementRemoved(element, callback)`: Executes the callback when the
  specified element is removed.

---

## 4. Internationalization (i18n)

### `i18n.mjs`

- **Purpose**: Handles all multi-language text translation, including dynamic
  updates and automatic translation of new elements.
- `async initTranslations(pageid, preferredLangs)`: **Call this early** in your
  page script. It fetches the language data for the specified page and user's
  preferred languages.
- `geti18n(key, params)`: Retrieves the translated string for a given key (e.g.,
  `home.title`). Supports interpolation with `params`.
- `i18nElement(element)`: **Use this after rendering new content** that was not
  created by `renderTemplate`. It automatically translates all descendant
  elements that have a `data-i18n` attribute. The `renderTemplate` function
  handles this automatically.
- `onLanguageChange(callback)` and `offLanguageChange(callback)`: Register or
  unregister a callback that fires whenever the language changes.
- `setLocalizeLogic(element, logic)`: Associates a localization logic with a
  specific DOM element. The logic is executed immediately and whenever the
  language changes. The association is automatically cleaned up when the element
  is removed from the DOM.
- `loadPreferredLangs()` and `savePreferredLangs(langs)`: Manage the user's
  preferred languages in `localStorage`.
- `getAvailableLocales()`: Fetches a list of all available locales from the
  server.
- **Automatic Translation**: The module automatically listens for browser
  language changes, visibility changes, and server-sent events
  (`locale-updated`) to re-initialize translations. It also uses a
  `MutationObserver` to translate new elements added to the DOM automatically.
- **Console and Dialog Wrappers**: Provides internationalized versions of common
  functions:
  - `console.infoI18n`, `console.logI18n`, `console.warnI18n`,
    `console.errorI18n`, `console.freshLineI18n`
  - `alertI18n`, `promptI18n`, `confirmI18n`

---

## 5. UI Components

### 5.1. JSON Editor (`jsonEditor.mjs`)

- `createJsonEditor(container, options)`: Creates a full-featured
  `vanilla-jsoneditor` instance inside the specified `container` element.

### 5.2. Terminal (`terminal.mjs`)

- `setTerminal(element)`: Creates a themed, functional `xterm.js` terminal
  instance inside the specified `element`.

### 5.3. Password Strength (`passwordStrength.mjs`)

- `initPasswordStrengthMeter(passwordInput, passwordStrengthFeedback)`:
  Initializes a password strength meter on a password input field.

### 5.4. Toast Notifications (`toast.mjs`)

- `showToast(type, message, duration)`: Displays a toast notification.
- `showToastI18n(type, key, params, duration)`: Displays a toast notification
  with an internationalized message.

### 5.5. Search (`search.mjs`)

- `makeSearchable({ searchInput, items, dataAccessor })`: Binds a search input
  to a list of items for automatic, live filtering.
- `createSearchableDropdown({ dropdownElement, dataList, textKey, valueKey, onSelect, dataAccessor })`:
  Creates and manages a searchable dropdown menu.

### 5.6. Part Path Picker (`partpath_picker.mjs`)

- `createPartpathPicker({ dropdown, breadcrumbList, menu, onChange, ... })`:
  Initializes a breadcrumb-style navigator for selecting fount "parts" (e.g.,
  shells, characters). Handles directory traversal and selection.

### 5.7. Virtual List (`virtualList.mjs`)

- `createVirtualList({ container, fetchData, renderItem, ... })`: Creates a
  high-performance virtual scrolling list for rendering large datasets. Supports
  dynamic buffering, bidirectional infinite scrolling, and item updates.

---

## 6. Security

### 6.1. Credential Manager (`credentialManager.mjs`)

- **Purpose**: Handles encryption, decryption, and transfer of credentials.
- `encrypt(plaintext, secret)`: Encrypts a plaintext string.
- `decrypt(encryptedJson, secret)`: Decrypts an encrypted payload.
- `transferEncryptedCredentials(uuid, redirectUrl)`: Encrypts and transfers
  credentials to a target URL.
- `retrieveAndDecryptCredentials(fileId, from, hashParams, uuid)`: Retrieves and
  decrypts credentials from a source.

### 6.2. POW Captcha (`POWcaptcha.mjs`)

- `createPOWCaptcha(container)`: Creates and manages a Proof-of-Work CAPTCHA
  widget.

---

## 7. Utilities

### 7.1. Regex (`regex.mjs`)

- `parseRegexFromString(input)`: Gets a real regex object from a slash-delimited
  regex string.
- `escapeRegExp(string)`: Escapes special characters in a string to be used in a
  regular expression.

### 7.2. URL Data Transfer (`urlDataTransfer.mjs`)

- **Purpose**: Handles transferring large amounts of data (e.g., URL parameters)
  when they exceed browser URL length limits. Supports fallback to clipboard or
  Catbox file hosting.
- `applyUrlParamsTransferStrategy(targetUrl, params)`: Automatically selects a
  transfer method (URL, Clipboard, or Catbox) based on data size.
- `retrieveUrlParams(currentParams)`: Retrieves parameters from the URL,
  clipboard, or external file.
