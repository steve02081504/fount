---
description: Deskpet shell — char-backed native WebUI pet windows, lifecycle traps, and launch/redirect flow. Pull when changing shells/deskpet.
globs: src/public/parts/shells/deskpet/**
alwaysApply: false
---

# Deskpet Shell

Runs a character as a desktop pet in a native `jsr:@webui/deno-webui` window. A character supplies the page via `interfaces.deskpet.GetPetConfig()`; characters without one get `src/default_interface/main.mjs` (the placeholder `public/default_pet.html`).

## Files

- `main.mjs` — `Load({ router })` plus `interfaces.invokes` (`ArgumentsHandler` / `IPCInvokeHandler`) and `interfaces.jobs` (`PauseJob` / `ReStartJob`).
- `src/pet_runner.mjs` — `runPet` / `stopPet` / `pausePet` / `getPetList` / `getRunningPets`. Per-user in-memory `runningPets`.
- `src/actions.mjs` — CLI/IPC actions (`list`, `list-running`, `start`, `stop`).
- `src/endpoints.mjs` — `start` / `stop` / `getrunningpetlist` under `/api/parts/shells:deskpet`.
- `public/src/redirect.mjs` — `resolveRedirect(value, origin)` used by the WebView bootstrap page.
- `test/integration/shell_module_graph.test.mjs` — `probeShellPart` graph check; `test/frontend/{smoke,redirect}.spec.mjs` — Playwright.

## Lifecycle traps

- `deno-webui` `show(content)` treats a leading `http(s)://` string as a URL (navigates), and its promise resolves **when the window connects, not when it closes**. Never revoke the temp API key or drop `runningPets` in the `.then` — that would kill the still-open pet. `watchWindowClose` polls `webview.isShown` and calls `stopPet` once the window disconnects; `stopPet` / `pausePet` clear that timer.
- Do not `await myWindow.show(...)` in the start path: it can block up to 30s waiting for connection. Register the pet, then attach `.then` / `.catch`.
- `setFrameless` / `setTransparent` are WebView-only; a browser-mode window ignores them. The pet page drags a frameless window with `-webkit-app-region: drag`.
- `set_cookie_and_redirect.html` reads `redirect` from `URLSearchParams` (already percent-decoded) and passes it to `resolveRedirect`, which must **not** call `decodeURIComponent` again — a bare `%` would throw `URIError`.

## Verification

`fount test shells/deskpet` — integration graph probe + frontend smoke/redirect.
