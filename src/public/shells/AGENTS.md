# AI Agent Guide: Shell Architecture & Creation

**Objective**: This document provides AI agents with a clear, actionable guide
to the architecture of fount Shells and the standard procedure for creating new
ones.

**Instruction**: **You must follow this architecture strictly.** Adherence to
this pattern ensures that new user interfaces (Shells) are modular,
maintainable, and integrate correctly with the fount ecosystem.

---

## 1. Standard Shell Architecture

A fount Shell is a self-contained module that provides a user interface and
corresponding backend logic. It consists of a frontend (served as static files)
and a backend (integrated into the main fount server).

The standard file structure is as follows. Note the clear separation between the
backend code (`src/`) and the frontend code (`public/`).

```tree
/src/public/shells/<your-shell-name>/
│
├── main.mjs                # [REQUIRED] Backend entry point. Implements ShellAPI_t.
├── home_registry.json      # (Optional) Registers this shell on the Home page UI.
├── argument_completer.ps1  # (Optional) PowerShell script for CLI argument completion.
│
├── public/                 # [REQUIRED] All frontend files go here.
│   ├── index.html          # [REQUIRED] The main HTML file for the shell.
│   ├── index.mjs           # [REQUIRED] The main JavaScript entry point for the frontend.
│   └── index.css           # (Optional) Custom styles for the shell.
│
└── src/                    # [REQUIRED] All backend files go here.
    ├── endpoints.mjs       # [STANDARD] Defines backend Express.js routes (HTTP & WebSocket).
    └── ...                 # (Optional) Other backend logic modules.
```

### Key File & Directory Responsibilities

1. **`main.mjs` (Backend Entry Point)**
   - **Role**: The Shell's manifest and lifecycle manager. This is how the fount
     `parts_loader` interacts with your Shell.
   - **`info`**: Metadata about the shell (name, description, author, etc.).
   - **`Load({ router })`**: This function is **required**. It's called when the
     Shell is loaded. Its primary job is to receive an Express `router` instance
     and use it to register the Shell's backend routes (both HTTP and
     WebSocket).
   - **`interfaces.invokes.IPCInvokeHandler`**: (Advanced) A powerful function
     that handles direct, non-HTTP server-side actions. It's ideal for complex
     operations that don't fit the simple request/response model, such as the
     AI-driven logic in `shellassist`.

2. **`public/` (Frontend Directory)**
   - **Role**: Contains all static assets for the user interface. These files
     are served directly to the user's browser.
   - **`index.html`**: The main page structure. It should include standard fount
     headers (`/base.css`, `/preload.mjs`, `/base.mjs`).
   - **`index.mjs`**: The core frontend logic. It should import and use common
     scripts from `@src/pages/scripts/` for tasks like theming (`applyTheme`),
     translation (`initTranslations`), and using pre-built components
     (`setTerminal`).

3. **`src/` (Backend Directory)**
   - **Role**: Contains all the Node.js backend logic for the shell.
   - **`endpoints.mjs`**: Exports a `setEndpoints(router)` function. This is
     where you define all your API endpoints (`router.get`, `router.post`) and
     WebSocket handlers (`router.ws`). This keeps all routing logic organized in
     one place.

4. **`home_registry.json` (Home Shell Integration)**
   - **Role**: Makes your Shell discoverable and accessible from the main fount
     `home` shell UI.
   - `home_function_buttons`: Adds a button to the main menu on the `home` shell
     that links to your Shell's `index.html`.

5. **`argument_completer.ps1` (CLI Integration)**
   - **Role**: Provides context-aware command-line completion for users
     interacting with your shell via the fount CLI (`fount run shells ...`).
     This enhances usability for power users.

---

## 2. How to Create a New Shell (Using `shellassist` as a Guide)

This example demonstrates a modern, interactive shell.

### Step 1: Create Directory Structure

Create the standard directory structure.

```bash
# From fount root directory
mkdir -p src/public/shells/my-new-shell/public
mkdir -p src/public/shells/my-new-shell/src
touch src/public/shells/my-new-shell/main.mjs
touch src/public/shells/my-new-shell/public/index.html
touch src/public/shells/my-new-shell/public/index.mjs
touch src/public/shells/my-new-shell/src/endpoints.mjs
```

### Step 2: Implement `main.mjs` (Backend Entry)

This file registers the shell and its routes. For an interactive shell, you
might also define an `IPCInvokeHandler`.

```javascript
// src/public/shells/my-new-shell/main.mjs
import { setEndpoints } from './src/endpoints.mjs';
// If you have complex logic, you might import a handler
// import { myCustomInvokeHandler } from './src/invoke_handler.mjs';

export default {
  info: {
    '': {
      name: 'my-new-shell',
      description: 'A description for my new interactive shell.',
      version: '0.0.0',
      author: 'UserName',
    },
  },
  // The Load function is passed a router to register its endpoints
  Load: ({ router }) => {
    setEndpoints(router);
  },
  Unload: () => {},
  // (Optional) For complex, non-HTTP interactions
  interfaces: {
    invokes: {
      // This handler can be called directly from other parts of the server
      // See shellassist/main.mjs for a real-world example
      IPCInvokeHandler: async (username, data) => {
        console.log(`IPCInvokeHandler called for ${username} with data:`, data);
        // return myCustomInvokeHandler(username, data);
        return { status: 'ok' };
      },
    },
  },
};
```

### Step 3: Define Backend Endpoints (`src/endpoints.mjs`)

Define the server-side logic, including WebSocket handlers for real-time
communication.

```javascript
// src/public/shells/my-new-shell/src/endpoints.mjs
import { authenticate } from '../../../server/auth.mjs';
import { handleTerminalConnection } from './terminal_ws.mjs'; // Example from shellassist

export function setEndpoints(router) {
  // Standard HTTP endpoint
  router.get('/api/shells/my-new-shell/info', authenticate, (req, res) => {
    res.status(200).json({ message: 'Welcome to my new shell!' });
  });

  // WebSocket endpoint for interactive terminal
  // The 'ws' method is added by the 'express-ws' middleware used in fount
  router.ws('/ws/shells/my-new-shell/terminal', authenticate, (ws, req) => {
    console.log('WebSocket connection established!');
    // The actual terminal logic would be in a separate module
    // handleTerminalConnection(ws); // See shellassist/src/terminal_ws.mjs

    ws.on('message', (msg) => {
      ws.send(`You sent: ${msg}`);
    });

    ws.on('close', () => {
      console.log('WebSocket was closed');
    });
  });
}
```

### Step 4: Create Frontend (`public/index.html` & `public/index.mjs`)

Define the UI and connect it to the backend. For an interactive terminal, we use
`xterm.js` via the shared `terminal.mjs` script.

**`public/index.html`:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>My New Shell</title>
    <!-- Standard fount includes -->
    <script blocking="render" type="module" src="/preload.mjs"></script>
    <link href="https://cdn.jsdelivr.net/npm/daisyui/daisyui.css" rel="stylesheet" type="text/css" crossorigin="anonymous" />
    <link href="/base.css" rel="stylesheet" type="text/css" crossorigin="anonymous" />
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" crossorigin="anonymous"></script>
    <script type="module" src="/base.mjs"></script>
    <!-- Xterm.js styles for the terminal -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm/css/xterm.min.css" />
  </head>
  <body class="flex flex-col h-screen items-center justify-center p-4">
    <!-- Container for the terminal -->
    <div id="terminal" class="mockup-code border bg-base-content w-full h-full"></div>
    <!-- Main script for this page -->
    <script type="module" src="./index.mjs"></script>
  </body>
</html>
```

**`public/index.mjs`:**

```javascript
import { applyTheme } from '../../scripts/theme.mjs';
import { geti18n, initTranslations } from '../../scripts/i18n.mjs';
import { setTerminal } from '../../scripts/terminal.mjs'; // Shared terminal helper

// Standard Initialization
applyTheme();
await initTranslations('my-new-shell');

// 1. Create a terminal instance using the shared helper
const terminal = setTerminal(document.getElementById('terminal'));
terminal.writeln('Welcome to My New Shell!');

// 2. Connect to the WebSocket backend
const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socketUrl = `${socketProtocol}//${window.location.host}/ws/shells/my-new-shell/terminal`;
const ws = new WebSocket(socketUrl);

ws.onopen = () => {
  terminal.writeln('WebSocket connection established.');
};

ws.onmessage = (event) => {
  // Write data from the server directly to the terminal
  terminal.write(event.data);
};

ws.onclose = () => {
  terminal.writeln('WebSocket connection closed.');
};

// 3. Send data from the terminal to the server
terminal.onData((data) => {
  ws.send(data);
});
```

After completing these steps, restart the fount server. The new shell will be
available at `/shells/my-new-shell/`.
