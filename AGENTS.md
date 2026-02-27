# fount Architecture & AI Agent Guide

## 1. Philosophy & Core Principles

- **Part-Based Modular Architecture**: Everything (UI, AI, Features) is a self-contained "part" loaded dynamically.
- **Evergreen Dependencies**: No lock files. Imports are directly from URLs via Deno.
- **Single Process**: Monolithic process; no child processes allowed. Use `async/await`.

## 2. System Overview

- **Server (`@src/server/`)**: Express-based. `parts_loader.mjs` is the heart, managing the lifecycle of all parts.
- **Parts**: Directory-based modules with a `main.mjs` entry point. Types: `shells`, `chars`, `worlds`, `personas`, `plugins`, `serviceSources`, etc.
- **APIs & Types**: Defined in `@src/decl/` (e.g., `CharAPI_t` in `charAPI.ts`). **Consult these files for required methods.**
- **Data Structures**:
  - `prompt_struct_t`: Central prompt building (@src/decl/prompt_struct.ts).
  - `chatMetadata_t`: Chat session state (@src/public/parts/shells/chat/src/chat.mjs).

## 3. Development Guidelines

- **Create New Parts**: Mimic existing examples in `@src/public/parts/` or `@data/users/.../chars/`.
- **UI (Shells)**: Decoupled from backend. Use API endpoints in `src/server/web_server/endpoints.mjs`.
- **I18n**: Only modify `src/locales/zh-CN.json`; `update-locales.py` handles the rest.
- **Standards**: Run `eslint --fix --quiet` after changes. No logging unless error/warning.

## 4. Specialized Guides

- [Frontend Common Functions Guide](src/public/pages/AGENTS.md)
- [Shell Architecture Guide](src/public/parts/shells/AGENTS.md)
- [Plugin Architecture Guide](src/public/parts/plugins/AGENTS.md)
