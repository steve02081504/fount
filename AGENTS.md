# fount Architecture & AI Agent Prompting Guide

## 1. Project Overview

fount is a modular, multi-user, and extensible framework for building interactive chat experiences with AI characters. Its core is a robust backend server that manages users, AI connections, and various **"parts"** that define the application's behavior. The architecture is designed for high customizability, allowing developers to create unique characters, worlds, user interfaces (shells), and plugins.

## 2. fount Philosophy

fount is built on a set of core principles that guide its architecture and development. Understanding these is crucial for contributing effectively.

- **Modular and Extensible**: The entire application is built around the **"part-based"** system. This is the most fundamental concept. The goal is to allow any piece of functionality—from a UI (shell) to an AI character (char) or a new feature (plugin)—to be added or removed as a self-contained module without altering the core server. This makes the system highly customizable and easy to extend.

- **Always Evergreen**: fount avoids dependency lock files (like `package-lock.json` or `deno.lock`). Dependencies are imported directly from URLs, ensuring that the project always uses the latest available versions. This philosophy prioritizes staying current with the latest features and security updates over the strict reproducibility of older versions. It embraces a bit of controlled chaos for the sake of being on the cutting edge.

- **Single Process Simplicity**: fount operates as a single, monolithic JavaScript process under the Deno runtime. Spawning child processes (e.g., using `Deno.Command`, Node's `spawn`, or workers for tasks that can be done asynchronously in the main thread) is strictly forbidden. This design choice simplifies debugging, state management, and deployment. Asynchronous operations should be handled using native `async/await` and non-blocking calls within the single process.

## 3. Core Architecture: The "Part-Based" System

The project follows a modular, **"part-based"** architecture. The server dynamically loads and manages different types of components (parts) for each user. Understanding this is critical for any modification.

- **Server (`@src/server/`)**: The core backend built with Express.js.
  - `server.mjs`: Main entry point; initializes the web server, IPC, and other core services. It dynamically loads `web_server/index.mjs` to handle HTTP requests.
  - `web_server/index.mjs`: The main entry point for the Express application. It sets up all core middleware, including logging, authentication, static file serving (`express.static`), and API routing. It uses a multi-router setup (`mainRouter`, `PartsRouter`, `FinalRouter`) to organize request handling, with `FinalRouter` acting as the final 404 catch-all. **Understanding the middleware order in this file is critical for debugging routing issues.**
  - `auth.mjs`: Handles user management (registration, login, sessions with JWT, passwords with Argon2) and user data directories.
  - `parts_loader.mjs`: **The heart of the modular system.** Responsible for the entire lifecycle (discovery, loading, initialization, unloading) of all "parts". It serves as the direct API for part management, discovering parts by scanning designated directories, identifying `main.mjs` as the entry point, and handling automatic updates for git-based parts. Callers of `parts_loader` functions are responsible for providing correctly constructed `partpath` strings (e.g., `shells/my-shell`).

- **Parts (Components)**: Self-contained modules defining a piece of functionality. The main types are:
  - **`shells`**: User interfaces (e.g., a web chat UI, a command-line interface).
  - **`chars`**: AI characters with unique personalities and logic.
  - **`worlds`**: The environment or context for a chat, managing multiple characters and global events.
  - **`personas`**: User profiles or "avatars" defining the user's representation in the chat.
  - **`AIsourceGenerators` / `AIsources`**: Connectors to AI model APIs. `AIsourceGenerator` is the factory that creates configured `AIsource` instances.
  - **`ImportHandlers`**: Handlers for importing characters or data from external formats (e.g., SillyTavern, Risu).
  - **`plugins`**: Extend chat functionality, such as by adding new commands or modifying prompts.

## 4. Key APIs & Component Definitions (`@src/decl/`)

These TypeScript (`.ts`) files define the interfaces that all "parts" must adhere to; type names use the `_t` suffix (e.g. `CharAPI_t` in `charAPI.ts`). **Consult these files to understand the required methods and properties for any part you create or modify.**

- **`CharAPI_t`**: The interface for a character.
  - `interfaces.chat.GetPrompt`: Crucial method to add the character's personality, memories, and context to the main prompt structure.
  - `interfaces.chat.GetPromptForOther`: Defines how the character's prompt appears to other characters in a group chat.
  - `interfaces.chat.TweakPrompt`: Allows for modifications of the prompt before it is sent to the AI.
  - `interfaces.chat.TweakPromptForOther`: Allows for modifications of the prompt for other characters in a group chat.
  - `interfaces.chat.GetReply`: Generates a reply in a conversation.
  - `interfaces.chat.GetGreeting`: Provides the initial message when a character joins a chat.

- **`WorldAPI_t`**: The interface for a chat environment.
  - Manages the overall chat log and can orchestrate interactions between multiple characters.

- **`UserAPI_t` (`Persona`)**: The interface for a user's persona.
  - `interfaces.chat.GetPrompt`: Defines the user's persona, instructions, or background.

- **`ShellAPI_t`**: The interface for a user interface.
  - `Load`/`Unload`: Hooks to register/unregister API endpoints and WebSocket routes using the provided `router`.

- **`ImportHandlerAPI_t`**: The interface for import handlers.
  - `interfaces.import.GetSources`: Returns available sources or files to import.
  - `interfaces.import.Import`: Executes the import process.

- **`PluginAPI_t`**: The interface for a plugin.
  - `interfaces.chat.GetPrompt`: Allows plugins to add their own context to the prompt.
  - `interfaces.chat.ReplyHandler`: Can process a character's reply, potentially triggering new actions or re-generating the response.

## 5. Core Data Structures

- **`prompt_struct_t` (`@src/decl/prompt_struct.ts`)**: The central data structure for building a prompt for the AI. It aggregates context from all active parts.
- **Chat State (`@src/public/parts/shells/chat/src/chat.mjs`)**:
  - **`chatMetadata_t`**: Represents the entire state of a single chat session. This is the primary object saved to disk as a JSON file.
  - **`timeSlice_t`**: A snapshot of the chat's context at a specific point in time (i.e., for a single message). **Crucial for maintaining state consistency.**
  - **`chatLogEntry_t`**: A single message in the chat log, containing a `timeSlice` property. Type definitions also exist in `@src/public/parts/shells/chat/decl/chatLog.ts` and `@src/decl/prompt_struct.ts`.

## 6. Task Implementation Patterns

To effectively modify or extend fount, follow these patterns. The fundamental principle is that each part is a directory containing a `main.mjs` file at its root, which serves as the entry point.

- **To create a new part (e.g., a Character)**: Create a new directory (e.g., `/data/users/<user>/chars/<charname>/`). In that directory, create a `main.mjs` file that exports a default object implementing the required API (e.g., `CharAPI_t`).
- **To change a character's personality**: Modify the `GetPrompt` method in the character's `main.mjs` file.
- **To add a new chat feature/command**: Create a new **Plugin** part. Its `main.mjs` will implement the `PluginAPI_t`, using `GetPrompt` to inform the AI and `ReplyHandler` to execute logic.
- **Advanced: Parent-Delegated Loading**: A parent part can manage the loading of its own children. If a parent's `main.mjs` exports `interfaces.parts.loadSubPart`, the `parts_loader` will use it to load any part that is a child of it; optionally export `interfaces.parts.unloadSubPart` to handle unloading. This allows for complex, hierarchical parts where the parent controls the lifecycle and environment of its children (see e.g. `@src/public/parts/chars/main.mjs`, `@src/public/parts/worlds/main.mjs`).

## 7. Additional Developer Documentation

For more specific development tasks, refer to the following detailed guides (paths are relative to the project root):

- **[Frontend Common Functions Guide](src/public/pages/AGENTS.md)** — shared frontend scripts (theming, i18n, API helpers, templates, markdown, etc.).
  - **Purpose**: Your primary reference for all shared frontend JavaScript helper functions in `src/public/pages/scripts/`.
  - **When to Consult**: Before developing any new frontend page or component, check this guide first to see if a utility function already exists. This promotes code reuse and consistency.

- **[Shell Architecture & Creation Guide](src/public/parts/shells/AGENTS.md)** — Shell structure, URL-to-filesystem mapping, and creation steps.
  - **Purpose**: A complete guide to understanding and building user interfaces (Shells).
  - **When to Consult**: When you need to create a new Shell from scratch or need to understand the structure and backend/frontend interaction of existing Shells.

- **[Plugin Architecture & Creation Guide](src/public/parts/plugins/AGENTS.md)** — Plugin structure, ReplyHandler, and tool-call logging.
  - **Purpose**: Essential points for creating Plugins (GetPrompt, ReplyHandler, AddLongTimeLog). Emphasizes logging both the AI’s tool-invocation message and tool results.
  - **When to Consult**: When you need to create or modify a Plugin, or implement a ReplyHandler that processes tool/function calls.

## 8. AI Agent Guidelines

As an AI agent, your primary goal is to assist in developing fount by strictly adhering to its architecture and conventions.

1.  **Runtime and Dependencies**: fount is a [Deno](https://deno.land/) project. It manages its own dependencies, so you do not need to run `npm install`. The project includes scripts that handle dependency installation automatically.
2.  **Check for Specific Guides First**: Before starting any task, **you must first search for and read any `AGENTS.md` file located in the relevant subdirectory.** For example, if the task involves a Shell, read `src/public/parts/shells/AGENTS.md`; if it involves a Plugin, read `src/public/parts/plugins/AGENTS.md`. These specific guides take precedence over the general guidelines in this document.
3.  **Respect the Architecture**: fount is a **"part-based"** system. All new functionality should be implemented within the appropriate part type (Shell, Char, Plugin, etc.). Do not add logic to the core server unless absolutely necessary. When course-correcting based on new information, ensure all original, still-valid requirements are maintained.
4.  **Consult General Documentation**: After checking for specific guides, review this document and the linked guides in Section 7. They provide the necessary context and patterns to follow.
5.  **Follow Existing Patterns**: Before creating a new part (e.g., a Shell, Char, or Plugin), **you must find and analyze a similar, existing part first.** For example, when creating a new Shell, examine the directory structure and files of another Shell like `discordbot` or `chat`. This is the most critical step to ensure new components integrate correctly. Mimic the observed file structure, naming conventions, and architectural patterns. When using a new library, consult its documentation carefully, especially regarding asynchronous behavior (e.g., blocking vs. non-blocking calls) to ensure it fits the project's architecture. Do not introduce external dependencies (like `package.json`) or architectural patterns not already present in similar parts.
6.  **Linting and Formatting**: After making any code changes, you must run `eslint --fix --quiet` to ensure the code adheres to the project's style guide and to automatically fix any minor formatting issues. This is a mandatory step before considering a task complete.
7.  **API-Driven UI**: Shells (UIs) must be decoupled from the backend. All communication should happen through well-defined API endpoints. Follow the pattern of defining backend routes in `src/server/web_server/endpoints.mjs` and creating corresponding fetch helpers in `src/public/pages/scripts/endpoints.mjs` (for app-wide APIs) or in the shell's own `public/` or `public/src/` (e.g. `src/public/parts/shells/<shell>/public/src/endpoints.mjs`) for shell-specific APIs.
8.  **Update Documentation**: If you learned new things or added a new, reusable component or made a significant change to the architecture, update the relevant `AGENTS.md` file to reflect your changes. This is crucial for future AI agents.
9.  **Localization (i18n)**: When adding or changing text that requires translation, you only need to modify the source localization file: `src/locales/zh-CN.json`. The system has an automated process (`update-locales.py`) that propagates these changes to all other language files. Do not manually edit other `.json` locale files.
10. **Logging**: Do not log any information unless it is an error or a warning. This helps to keep the logs clean and focused on actionable issues.
