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

Controls: Ctrl+C or hold Esc ≥4s exits (teardown plays farewell exit, then quit). Left quick-click → ripple; left hold/drag → cool spotlight (ambient dims). Right-drag → stroke wind; right long-still → tornado vortex (can suspend rain and lift free-liquid puddles). Alt-screen (`1049h`/`1049l`) restores prior scrollback on exit.

## Modules

| Path | Role |
| --- | --- |
| `index.mjs` | CLI entry + public re-exports |
| `session.mjs` | Singleton session API; starts/stops device gravity |
| `gravity.mjs` | Gravity **processing** (smooth unit vector `{gx,gy,mag}`); loads acquire backend |
| `gravity_acquire/` | Signal **acquisition**: `browser` (GravitySensor → DeviceMotionEvent) / `termux` / `none` |
| `icon.mjs` | Packed silhouette, pillars, body growth order |
| `scene.mjs` | Anim state, materials, rain edges, pool leak, enter/hold/exit, resize |
| `compose.mjs` | Frame paint + ANSI; lava palette; pointer torch/ripples |
| `player.mjs` | TUI singleton: `canUseTui`, play/loop, mouse, alt-screen, console block |
| `terminal.mjs` | `canUseTui` (TTY + ANSI); consumed only by `player.mjs` |
| `gesture/` | `pointer` / `light` (torch+ripple) / `wind` (stroke+vortex) |
| `terrain.mjs` | Pedestal-anchored surface + caves + test vessel templates |
| `hash.mjs` | `hash01` + fBm + ortho deltas |
| `fluid/` | Particles, liquid/melt, soil, thermal, boundary, bubbles, gas, glyphs |

`fluid/` files: `mat` (density/`rhoOf`/`viscOf` + visc ladder), `flow`, `components` (shared BFS label), `equilibrate` (Boyle / φ), `transport` (condensed-phase kernel), `world`, `edges` (fractional edge roles), `boundary`, `thermal`, `bubbles`, `gas`, `liquid`, `soil`, `particles`, `step` (`stepFluid`), `glyphs`.

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
- **Viscosity ladder** is the sole branch knob: `≤ VISC_INERTIAL` → inertial gas velocity; `< VISC_SOLID` → Stokes mass flux; `≥ VISC_SOLID` → frozen.
- Water mass = `liq + moisture + condense + particles` (`totalWorldWater`); melt is separate. Closed transfers conserve; intentional sinks are world-edge / down-edge wipe / BODY impact. Particle expiry deposits back.
- Soil condense hangs on the gravity-down face; when ĝ leaves that open underside it reabsorbs into moisture. Drip glyphs follow `condenseDripSource` (ĝ), not screen-down.
- Terrain is **pedestal-anchored**; ungrown base keeps `HORIZON` until `POOL`/`SLOPE_*` overwrite. Resize shifts retained dynamics with the icon. New/expanded soil stays dry (no ambient `SOIL_CAP` fill — that would spring under inverted ĝ).
- Gravity is a continuous unit vector everywhere (particles + grid). Depth = projection on ĝ; neighbor transfer uses weights `max(0, d̂·ĝ)`.
- Four edges hold fractional roles `sink/source/wrap` from `n̂·ĝ` (sum to 1). Lava onset is **exposure work** `exposure[e] = max(0, exposure[e] + n̂·ĝ)` with decay when flipped (≥ `LAVA_ONSET_EXPOSURE`); 45° → two edges each need ~13·√2 s. Condensed-phase edge sinks must not read OOB cells (ambient `P_ATM`) — otherwise melt goes `NaN` and `max(NaN, inject)` never recovers.
- Gravity acquire: `document` → browser APIs; Termux → `termux-sensor` (pretty JSON indent=2, `parseSensorStdout`); else no-op. path CLI installs `termux-api` on `fount logo` / `log` / `server` when missing. Termux stop **must** `termux-sensor -c` *before* killing the stream CLI — SensorAPI only unregisters while `outputWriter` is alive; kill-first leaves listeners stuck in Termux:API (force-stop both apps to recover). Upstream: [termux-api#902](https://github.com/termux/termux-api/issues/902).
- Rain edges weighted by `source`; side wrap by `wrap`. Meltdown absorb records absorb-time ĝ; regurgitate when `ĝ·absorbDir` drops.
- Composition bottom (pedestal / lava edge) never rains — even when inverted ĝ makes it a physical sky; quiet until sink-edge exposure yields lava.
