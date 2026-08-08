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
| `signal` / `abort` | User abort of this icon session (Ctrl+C or hold Esc ≥4s, one-shot). `dismiss` does not touch it. Further ESC repeats / Ctrl+C are ignored until the next `player.start` so farewell exit can finish. |

Hosts own process-exit signaling and must wire `icon.signal` into it (log_viewer and server do). Non-TTY / no VT is gated only in `player.mjs` — session APIs stay callable (play paths no-op). On the alternate screen, `player` `block`/`unblock`s the global virtual console so console output is deferred; frame paint writes the native `targetStream` so the animation itself is not deferred.

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

Production deep-links `fluid/**`; `fluid/index.mjs` is the test/public barrel. Layout inside `fluid/` (gas/, liquid/, world/, …): [physics-notes.md](physics-notes.md).

## Material standard

Icon + terrain write the material grid. Free liquid / lava glyphs share the rain motion alphabet (`waterChar` / `lavaChar`); lava is slower via higher `viscOf`, not a separate charset. Never from gas wind.

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

Open-stage: ungrown base columns do not splash. Compose priority (top wins): particles → soft edges → body/pool/`lava`/water → drip → pillars → terrain outline.

## Invariants (do not break)

- **One pressure language** / **one density language** / **viscosity ladder** — see [physics-notes.md](physics-notes.md). Do not invent parallel hydro models.
- **Volume exclusivity**: `cellFill = liq+melt`, `cellRoom = LIQ_FULL−fill`. Never stack phases past one cell.
- Water mass = `liq + moisture + condense + particles` (`totalWorldWater`); melt is separate. Closed transfers conserve; intentional sinks are world-edge / down-edge wipe / BODY impact.
- Gravity is a continuous unit vector everywhere. Terrain is **pedestal-anchored**; land occupancy is `world.land` (alias `terrain.solid`). New/expanded soil stays dry.
- Four edges hold fractional `sink/source/wrap` from `n̂·ĝ`. Lava onset is exposure work (not instant flip). Condensed-phase edge sinks must not read OOB cells (ambient `P_ATM`) — otherwise melt goes `NaN` permanently.
- Composition bottom never rains. Any ĝ into the bottom zeroes **all** rain weights — side rain alone would mint water forever under Infinity `rainUntil`.
- Gravity acquire: `document` → browser APIs; Termux → `termux-sensor`; else no-op. path CLI installs `termux-api` on `fount logo` / `log` / `server` when missing. Termux stop **must** `termux-sensor -c` *before* killing the stream CLI — kill-first leaves listeners stuck ([termux-api#902](https://github.com/termux/termux-api/issues/902)).
