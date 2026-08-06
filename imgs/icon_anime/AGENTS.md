---
description: ASCII fountain logo animation — terrain, fluid pressure, gas wind, TUI player
globs: imgs/icon_anime/**
alwaysApply: false
---

# icon_anime

Standalone terminal animation for the fount fountain logo.

Physics / hot-path detail (not day-to-day): [physics-notes.md](physics-notes.md).

## Hosting

Process-wide singleton used by `fount logo`, the CLI log viewer, and the foreground server (`src/server/index.mjs`) when stdout is a real TTY.

| API | Role |
| --- | --- |
| `intro` | Enter animation, then background `hold` (no park) |
| `start` / `dismiss` | log_viewer while waiting for the server (`start` no-op if already running; `dismiss` when connected); server `dismiss`es when `init` returns `started` |
| `farewell` | On `on_shutdown` (safe mid-intro, e.g. `already_running`) |
| `signal` / `abort` | User abort of this icon session (Ctrl+C). `dismiss` does not touch it |

Hosts own process-exit signaling and must wire `icon.signal` into it (log_viewer and server do). Non-TTY / no VT is gated only in `player.mjs` — session APIs stay callable (play paths no-op). On the alternate screen, `player` `block`/`unblock`s the global virtual console so console output is deferred; frame paint writes the native `targetStream` so the animation itself is not deferred.

## Run

```bash
fount logo
fount logo watch   # deno run --watch
fount test icon_anime --no-parallel
```

Controls: Ctrl+C exits (icon teardown, then quit). Left quick-click → ripple; left hold/drag → cool spotlight (ambient dims). Right-drag → stroke wind; right long-still → tornado vortex (can suspend rain and lift free-liquid puddles). Alt-screen (`1049h`/`1049l`) restores prior scrollback on exit.

## Modules

| Path | Role |
| --- | --- |
| `index.mjs` | CLI entry + public re-exports |
| `session.mjs` | Singleton session API; starts/stops device gravity |
| `gravity.mjs` | Termux `termux-sensor` via `node:child_process`; default screen-down elsewhere; continuous vector + 4-axis quantize |
| `icon.mjs` | Packed silhouette, pillars, body growth order |
| `scene.mjs` | Anim state, materials, rain edges, pool leak, enter/hold/exit, resize |
| `compose.mjs` | Frame paint + ANSI; lava palette; pointer torch/ripples |
| `player.mjs` | TUI singleton: `canUseTui`, play/loop, mouse, alt-screen, console block |
| `terminal.mjs` | `canUseTui` (TTY + ANSI); consumed only by `player.mjs` |
| `gesture/` | `pointer` / `light` (torch+ripple) / `wind` (stroke+vortex) |
| `terrain.mjs` | Pedestal-anchored surface + caves + test vessel templates |
| `hash.mjs` | `hash01` + fBm + ortho deltas |
| `fluid/` | Particles, liquid/melt, soil, thermal, boundary, bubbles, gas, glyphs |

`fluid/` files: `mat` (density/`rhoOf`/`viscOf`), `flow`, `world`, `edges`, `boundary`, `thermal`, `bubbles`, `gas`, `liquid`, `soil`, `particles`, `step` (`stepFluid`), `glyphs`.

## Material standard

Icon + terrain write the material grid. Free liquid / lava glyphs come from amount × liquid velocity (`waterChar` / `lavaChar`), never from gas wind.

| Glyph / mat | Behavior |
| --- | --- |
| `@` (`BODY`) | Impact shell: splash then vanish — no merge, no flood |
| `:` | Compose-only pillars — **not** material; liquid/particles pass through |
| `@` (`POOL`) | Absorb then leak to lower slab / ground |
| `>` / `<` (`SLOPE_*`) | 45° splash faces |
| `HORIZON` / `SOLID` | Soil moisture field; crust under icon may sit on caves |
| `SEAL` | Impermeable test/vessel barrier (no moisture) |
| `AIR` | Empty air; melt mass lives in `melt`/`temp` on AIR cells |
| melt | Rock continuum; viscosity from `viscOf(rhoOf(ROCK,temp))`; bubbles = sealed air in melt |

Open-stage: ungrown base columns do not splash — rain falls through until it hits mat/horizon or leaves. Compose priority (top wins): particles → soft edges → body/pool/`lava`/water → drip → pillars → terrain outline.

## Invariants (do not break)

- **One pressure language** / **one density language** — see [physics-notes.md](physics-notes.md). Do not invent parallel hydro models.
- Water mass = `liq + moisture + condense + particles` (`totalWorldWater`); melt is separate. Closed transfers conserve; intentional sinks are world-edge / down-edge wipe / BODY impact. Particle expiry deposits back.
- Terrain is **pedestal-anchored**; ungrown base keeps `HORIZON` until `POOL`/`SLOPE_*` overwrite. Resize shifts retained dynamics with the icon.
- Particles: continuous `world.gravity`. Grid: quantized 4-axis. Rain edges weighted by `−outward·ĝ` (gravity-down edge weight 0).
- Termux: `gravity.mjs` → `termux-sensor`; path CLI installs `termux-api` on `fount logo` / `log` / `server` when missing.
- Down edge (screen-down long enough): lava source. Up edge: rain + melt absorb/regurgitate. Side: wrap perpendicular to gravity.
