---
description: ASCII fountain logo animation — terrain, fluid pressure, gas wind, TUI player
globs: imgs/icon_anime/**
alwaysApply: false
---

# icon_anime

Standalone terminal animation for the fount fountain logo.

Physics / materials / hot-path: [docs/physics-notes.md](docs/physics-notes.md).

## Hosting

Process-wide singleton used by `fount logo`, the CLI log viewer, and the foreground server (`src/server/index.mjs`) when stdout is a real TTY. Browser hosts pass a DOM terminal via `setIO`. Demo page: [`index.html`](index.html) (inline: `setTerminal` from `/fount/scripts/components/terminal.mjs`, then `setIO(terminal).intro()`). GitHub Pages / pages mapping server: `/imgs/icon_anime/`.

`player/` and `terminal/` load Node (`npm:`) vs browser (`https://esm.sh/…`) implementations with `if (globalThis.document)`, same pattern as `gravity_acquire/`. Shared modules must not static-import `node:*` / `npm:`.

| API | Role |
| --- | --- |
| `intro` | Enter animation, then background `hold` (no park) |
| `start` / `dismiss` | log_viewer while waiting for the server (`start` no-op if already running; after `dismiss` resumes hold only — no re-enter; `dismiss` when connected); server `dismiss`es when `init` returns `started` |
| `farewell` | On `on_shutdown` (safe mid-intro, e.g. `already_running`) |
| `signal` / `abort` | User abort of this icon session (Ctrl+C or hold Esc ≥4s, one-shot). `dismiss` does not touch it. Further ESC repeats / Ctrl+C are ignored until the next `player.start` so farewell exit can finish. |
| `setIO(io)` | Bind IO. Pass a DOM terminal (`setIO(terminal)`) or `{ console, stdin, stdout }`. Default `console` is the VC global; omitted `stdout` uses `console._stdout`; omitted `stdin` is `process.stdin` on Node (required in the browser). |

Hosts own process-exit signaling and must wire `icon.signal` into it (log_viewer and server do). Non-TTY / no VT is gated only in the player — session APIs stay callable (play paths no-op). Alt-screen: player `block()`s the bound console; frame paint uses `stdout.targetStream.write`.

## Run

```bash
fount logo
fount logo watch   # deno run --watch
fount test icon_anime
fount test icon_anime:frontend
```

Controls: Ctrl+C or hold Esc ≥4s exits (teardown plays farewell exit, then quit). Left quick-click → ripple; left hold/drag → cool spotlight. Right-drag → stroke wind; right long-still → tornado vortex. Alt-screen (`1049h`/`1049l`) restores prior scrollback on exit. Autowrap off (`?7l`) while the TUI is up.

Tests under `test/` (`fluid_*`, `anim`, `terrain`, `gravity_*`) plus `test/frontend` (Playwright via the Pages mapping server: `setIO`, play, stop restores the normal buffer). Demo `/imgs/icon_anime/` hangs `globalThis.terminal` (DOM xterm) and `globalThis.icon` (session API).

## Modules

| Path | Role |
| --- | --- |
| `index.html` | Browser demo: DOM xterm + `intro()`; hangs `globalThis.terminal` / `icon` |
| `index.mjs` | CLI entry + public re-exports |
| `session.mjs` | Singleton session API; starts/stops device gravity; re-exports `setIO` |
| `io.mjs` | `setIO` / `canUseTui` / `terminalSize` / `watchTerminalSize` |
| `gravity.mjs` | Gravity processing (smooth unit vector `{gx,gy,mag}`); loads acquire backend |
| `gravity_acquire/` | Signal acquisition: `browser` / `termux` / `none` |
| `icon.mjs` | Packed silhouette, pillars, body growth order |
| `scene/` | Anim state, resize, sim, enter/hold/exit, rain/pool/materials |
| `compose/` | Palette, buffer render, `composeFrame` |
| `player.mjs` | Re-exports TUI player; host defaults from `player/node.mjs` or `player/browser.mjs` |
| `player/shared.mjs` | play/loop, mouse, alt-screen, console block |
| `terminal/` | Host ANSI: `node.mjs` / `browser.mjs` |
| `gesture/` | Pointer, light (torch+ripple), wind (stroke+vortex) |
| `terrain/` | Surface + caves |
| `hash.mjs` | `hash01` + fBm + ortho deltas |
| `fluid/` | Particles, liquid/melt, soil, thermal, boundary, bubbles, gas, glyphs |

Production deep-links `fluid/**`; `fluid/index.mjs` is the test/public barrel. Layout inside `fluid/`: [docs/physics-notes.md](docs/physics-notes.md).

DOM xterm (`src/public/pages/scripts/components/terminal.mjs`): `terminal.stdin` / `stdout` / `stderr` match `process.std*`; `terminal.console._stdout` / `_stderr` are those same streams (no `console._stdin`).

## Do not break

- **One pressure language / one density language / viscosity ladder** — see [physics-notes.md](docs/physics-notes.md). Do not invent parallel hydro models.
- Gravity acquire: `document` → browser APIs; Termux → `termux-sensor`; else no-op. path CLI installs `termux-api` on `fount logo` / `log` / `server` when missing. Termux stop **must** `termux-sensor -c` *before* killing the stream CLI ([termux-api#902](https://github.com/termux/termux-api/issues/902)).
- Sensors only while the icon TUI is up (`canUseTui()` + `openTui`). `dismiss` stops acquire **before** tearing down play/alt-screen; `abort` / `farewell` also stop.
