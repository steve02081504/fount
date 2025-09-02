# AI Agent Guide: Shell Architecture & Creation

**Objective**: This document provides AI agents with a clear, actionable guide to the architecture of fount Shells and the standard procedure for creating new ones.

**Instruction**: **You must follow this architecture strictly.** Adherence to this pattern ensures that new user interfaces (Shells) are modular, maintainable, and integrate correctly with the fount ecosystem.

---

## 1. Standard Shell Architecture

A fount Shell is a self-contained UI module. It consists of a frontend (HTML/CSS/JS) and a dedicated set of backend API endpoints. The standard file structure is as follows:

```tree
/src/public/shells/<your-shell-name>/
│
├── main.mjs                # [REQUIRED] Backend entry point. Implements ShellAPI_t.
├── index.html              # [REQUIRED] Frontend main HTML page.
├── index.mjs               # [REQUIRED] Frontend main JavaScript logic.
├── index.css               # (Optional) Custom styles for the shell.
├── home_registry.json      # (Optional) Registers this shell's features on the Home shell.
│
└── src/
    ├── server/
    │   ├── endpoints.mjs   # [STANDARD] Defines all backend Express.js API routes.
    │   └── ...             # (Optional) Other backend logic modules (e.g., manager.js).
    │
    └── public/
        ├── endpoints.mjs   # [STANDARD] Frontend helpers to fetch from the backend APIs.
        └── ...             # (Optional) Other frontend scripts, templates, etc.
```

### Key File Responsibilities

1. **`main.mjs` (Backend Entry Point)**
   - **Role**: The Shell's manifest and lifecycle manager. This is how the fount `parts_loader` interacts with your Shell.
   - **Exports**: A default object with `info`, `Load`, and `Unload`.
   - `Load({ router })`: This function is **required**. It is called when the Shell is loaded. Its primary job is to receive the Express `router` and pass it to your `setEndpoints` function to register the Shell's API routes.
   - `interfaces`: (Optional) Defines handlers for fount's command-line (`invokes`) or scheduled task (`jobs`) systems.

2. **`/src/server/endpoints.mjs` (Backend API Definitions)**
   - **Role**: To define all API endpoints for this Shell.
   - **Pattern**: Export a single function `setEndpoints(router)`. Inside this function, attach all your `router.get()`, `router.post()`, etc., routes. **All routes must be protected by the `authenticate` middleware.**

3. **`/src/public/endpoints.mjs` (Frontend API Client)**
   - **Role**: To create a clean, reusable API layer for your frontend.
   - **Pattern**: For each backend endpoint, export a corresponding `async` function that uses `fetch` to call it. This decouples your main UI logic from the raw API URLs and request details.

4. **`home_registry.json` (Home Shell Integration)**
   - **Role**: Makes your Shell discoverable and accessible from the main fount `home` shell.
   - `home_function_buttons`: Adds a button to the main menu on the `home` shell that links to your Shell.
   - `home_*_interfaces`: Adds action buttons to the cards on the `home` shell (e.g., adds a "Configure" button to all `char` parts that links to your shell).

---

## 2. How to Create a New Shell

Follow these steps precisely to create a new Shell named `my-new-shell`.

### Step 1: Create Directory and Files

Create the standard directory structure and empty files.

```bash
# From fount root directory
mkdir -p src/public/shells/my-new-shell/src/server
mkdir -p src/public/shells/my-new-shell/src/public
touch src/public/shells/my-new-shell/main.mjs
touch src/public/shells/my-new-shell/index.html
touch src/public/shells/my-new-shell/index.mjs
touch src/public/shells/my-new-shell/src/server/endpoints.mjs
touch src/public/shells/my-new-shell/src/public/endpoints.mjs
```

### Step 2: Implement `main.mjs` (Backend Entry)

This file registers the shell with fount.

```javascript
// src/public/shells/my-new-shell/main.mjs
import { setEndpoints } from './src/server/endpoints.mjs';

export default {
  info: {
    '': {
      name: 'my-new-shell',
      description: 'A description for my new shell.',
      version: '0.0.1',
      author: 'YourName',
    },
  },
  Load: ({ router }) => {
    setEndpoints(router);
  },
  Unload: () => {},
};
```

### Step 3: Define Backend API (`/src/server/endpoints.mjs`)

Define the server-side logic.

```javascript
// src/public/shells/my-new-shell/src/server/endpoints.mjs
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs';

export function setEndpoints(router) {
  router.get(
    '/api/shells/my-new-shell/getData',
    authenticate,
    async (req, res) => {
      const { username } = await getUserByReq(req);
      res.status(200).json({
        message: `Hello, ${username}! This is data from my new shell.`,
        timestamp: new Date(),
      });
    },
  );
}
```

### Step 4: Create Frontend HTML (`index.html`)

Define the UI structure.

```html
<!-- src/public/shells/my-new-shell/index.html -->
<!DOCTYPE html>
<html data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <title data-i18n="my-new-shell.title">My New Shell</title>
    <!-- Standard fount CSS and JS includes -->
    <link
      href="https://cdn.jsdelivr.net/npm/daisyui/daisyui.css"
      rel="stylesheet"
      type="text/css"
    />
    <link href="/base.css" rel="stylesheet" type="text/css" />
    <script src="https://cdn.jsdelivr.net/npm/@unocss/runtime"></script>
    <script blocking="render" type="module" src="/preload.mjs"></script>
    <script type="module" src="/base.mjs"></script>
  </head>
  <body>
    <div class="container mx-auto p-4">
      <h1 class="text-2xl" data-i18n="my-new-shell.pageTitle">My New Shell</h1>
      <button id="fetchDataBtn" class="btn btn-primary">Fetch Data</button>
      <pre id="data-container" class="mt-4 p-4 bg-base-200 rounded-box"></pre>
    </div>
    <!-- Include this page's main script -->
    <script type="module" src="./index.mjs"></script>
  </body>
</html>
```

### Step 5: Implement Frontend API Client (`/src/public/endpoints.mjs`)

Create the `fetch` helper function.

```javascript
// src/public/shells/my-new-shell/src/public/endpoints.mjs
export async function getData() {
  const response = await fetch('/api/shells/my-new-shell/getData');
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }
  return response.json();
}
```

### Step 6: Write Frontend Logic (`index.mjs`)

Connect the UI to the API client.

```javascript
// src/public/shells/my-new-shell/index.mjs
import { applyTheme } from '../../scripts/theme.mjs';
import { initTranslations } from '../../scripts/i18n.mjs';
import { getData } from './src/public/endpoints.mjs';

// Standard Initialization
applyTheme();
initTranslations('my-new-shell'); // Use a unique pageid for i18n

const fetchDataBtn = document.getElementById('fetchDataBtn');
const dataContainer = document.getElementById('data-container');

fetchDataBtn.addEventListener('click', async () => {
  try {
    dataContainer.textContent = 'Loading...';
    const data = await getData();
    dataContainer.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    dataContainer.textContent = `Error: ${error.message}`;
    console.error(error);
  }
});
```

After completing these steps, restart the fount server. The new shell will be available at `/shells/my-new-shell/`.
