---
description: ASCII fountain logo animation — terrain, fluid pressure, gas wind, TUI player
globs: imgs/icon_anime/**
alwaysApply: false
---

# icon_anime

Standalone terminal animation for the fount fountain logo.

Physics / materials / hot-path: [docs/physics-notes.md](docs/physics-notes.md).

## Hosting

Process-wide singleton used by `fount logo`, the CLI log viewer, and the foreground server (`src/server/index.mjs`) when stdout is a real TTY.

| API | Role |
| --- | --- |
| `intro` | Enter animation, then background `hold` (no park) |
| `start` / `dismiss` | log_viewer while waiting for the server (`start` no-op if already running; after `dismiss` resumes hold only — no re-enter; `dismiss` when connected); server `dismiss`es when `init` returns `started` |
| `farewell` | On `on_shutdown` (safe mid-intro, e.g. `already_running`) |
| `signal` / `abort` | User abort of this icon session (Ctrl+C or hold Esc ≥4s, one-shot). `dismiss` does not touch it. Further ESC repeats / Ctrl+C are ignored until the next `player.start` so farewell exit can finish. |

Hosts own process-exit signaling and must wire `icon.signal` into it (log_viewer and server do). Non-TTY / no VT is gated only in `player.mjs` — session APIs stay callable (play paths no-op). Alt-screen: `player` blocks the global virtual console; frame paint uses the native `targetStream`.

## Run

```bash
fount logo
fount logo watch   # deno run --watch
fount test icon_anime --no-parallel
```

Controls: Ctrl+C or hold Esc ≥4s exits (teardown plays farewell exit, then quit). Left quick-click → ripple; left hold/drag → cool spotlight. Right-drag → stroke wind; right long-still → tornado vortex. Alt-screen (`1049h`/`1049l`) restores prior scrollback on exit.

Tests under `test/` (`fluid_*`, `anim`, `terrain`, `gravity_*`).

## Modules

| Path | Role |
| --- | --- |
| `index.mjs` | CLI entry + public re-exports |
| `session.mjs` | Singleton session API; starts/stops device gravity |
| `gravity.mjs` | Gravity processing (smooth unit vector `{gx,gy,mag}`); loads acquire backend |
| `gravity_acquire/` | Signal acquisition: `browser` / `termux` / `none` |
| `icon.mjs` | Packed silhouette, pillars, body growth order |
| `scene/` | Anim state, resize, sim, enter/hold/exit, rain/pool/materials |
| `compose/` | Palette, buffer render, `composeFrame` |
| `player.mjs` | TUI singleton: play/loop, mouse, alt-screen, console block |
| `terminal.mjs` | `canUseTui`, `terminalSize` / `watchTerminalSize` |
| `gesture/` | Pointer, light (torch+ripple), wind (stroke+vortex) |
| `terrain/` | Surface + caves |
| `hash.mjs` | `hash01` + fBm + ortho deltas |
| `fluid/` | Particles, liquid/melt, soil, thermal, boundary, bubbles, gas, glyphs |

Production deep-links `fluid/**`; `fluid/index.mjs` is the test/public barrel. Layout inside `fluid/`: [docs/physics-notes.md](docs/physics-notes.md).

## Do not break

- **One pressure language / one density language / viscosity ladder** — see [physics-notes.md](docs/physics-notes.md). Do not invent parallel hydro models.
- Gravity acquire: `document` → browser APIs; Termux → `termux-sensor`; else no-op. path CLI installs `termux-api` on `fount logo` / `log` / `server` when missing. Termux stop **must** `termux-sensor -c` *before* killing the stream CLI ([termux-api#902](https://github.com/termux/termux-api/issues/902)).
- Sensors only while the icon TUI is up (`canUseTui` + `openTui`). `dismiss` stops acquire **before** tearing down play/alt-screen; `abort` / `farewell` also stop.
