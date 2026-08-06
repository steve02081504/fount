---
description: ASCII fountain logo animation — terrain, fluid pressure, gas wind, TUI player
globs: imgs/icon_anime/**
alwaysApply: false
---

# icon_anime

Standalone terminal animation for the fount fountain logo.

Also embedded by the CLI log viewer and the foreground server entry (`src/server/index.mjs`) when stdout is a real TTY (process-wide singleton): `intro` plays enter then background `hold` (no park); log_viewer while waiting for the server uses `start` (no-op if already running) / `dismiss` when connected; server `dismiss`es when `init` returns `started`. `farewell` on `on_shutdown` (works from mid-intro too — e.g. `already_running`). `signal` means user abort of this icon session (Ctrl+C / `abort()`); dismiss does not touch it. Hosts own their process-exit signal and should wire `icon.signal` into it (log_viewer and server `index.mjs` do). Non-TTY / no VT is decided only in `player.mjs` — session APIs stay callable (play paths no-op). While the TUI is on the alternate screen, `player` calls global virtual-console `block`/`unblock` so console / virtual-stream output is deferred until leave; frame paint writes the native `targetStream` so the animation itself is not deferred. Non-TUI paths do not touch block.

## Run

```bash
fount logo
fount logo watch   # deno run --watch — reload on source change
```

Controls: Ctrl+C exit (icon teardown, then quit). Left quick-click → bright expanding ripple (no flashlight); left hold / drag → circular cool spotlight with fade-in/out (ambient dims + centre lifts; release fades off). Right-drag paints stroke wind along the path (faster drag → stronger flow); right long-press while still grows a tornado vortex at the cursor (clockwise + updraft + inflow; longer → faster; follows while moved, reforms when stopped, clears on release) that can suspend rain in orbit and suck free-liquid puddles airborne. Other stdin discarded.
Player uses the alternate screen buffer (`1049h`/`1049l`) so exit restores the pre-start scrollback and cursor row.

## Modules

| Path | Role |
| --- | --- |
| `index.mjs` | CLI entry + public re-exports |
| `session.mjs` | Process singleton: user-abort `signal`/`abort`, `intro` / `start`+`dismiss` / `farewell` / `sleep` |
| `icon.mjs` | Packed silhouette, pillars, body growth order (typed arrays) |
| `scene.mjs` | Anim state, materials, rain, pool leak, enter/hold/exit |
| `compose.mjs` | Frame paint + ANSI `renderBuffers` / `renderGrid`; pointer torch + click ripples (truecolor lift) |
| `player.mjs` | Process singleton TUI: `canUseTui` gate, play/loop, Ctrl+C → play abort + `onUserAbort`, SGR mouse, alt-screen, console `block`/`unblock` while on alt-screen |
| `terminal.mjs` | `canUseTui` (stdin+stdout TTY + ANSI); consumed only by `player.mjs` |
| `gesture/` | Pointer gestures (`pointer` press helper, `light` torch/ripple, `wind` stroke/vortex) |
| `terrain.mjs` | Pedestal-anchored surface + noise caves + U-tube/chamber templates |
| `hash.mjs` | `hash01` + 1D/2D fBm noise + `ORTHO_DX`/`ORTHO_DY` (terrain + fluid) |
| `fluid/` | Particles, grid liquid, soil, Boyle air regions, gas wind, glyphs |

### `gesture/`

| File | Role |
| --- | --- |
| `pointer.mjs` | Shared press / drag / release + cap trim |
| `light.mjs` | Left-button quick-click ripple vs hold torch (TORCH_FADE blend) |
| `wind.mjs` | Right-button stroke wind + long-still clockwise vortex → local gas drive field |

### `fluid/`

| File | Role |
| --- | --- |
| `index.mjs` | Barrel re-exports |
| `mat.mjs` | `MAT` enum, flags LUT, soil/liquid / gas density constants |
| `flow.mjs` | Shared Torricelli / sheet / hydraulic φ / mass-transfer primitives |
| `world.mjs` | Grid alloc, scratch buffers, mat/liq/moisture helpers, `totalWorldWater` |
| `gas.mjs` | Air regions, hydrostatic open P(y), wind, Bernoulli ΔP `stepGas` |
| `liquid.mjs` | Hydrostatic liquid P, gravity / orifice / graph-hydraulic `stepLiquid` |
| `soil.mjs` | Moisture / condensation / Matthew / drip `stepSoil` |
| `particles.mjs` | SoA rain/splash pools + gas drag; expire deposits mass |
| `step.mjs` | `stepFluid` — label → gas → lift → particles → liquid |
| `glyphs.mjs` | `waterChar` / `liquidChar` / `dripChar` |

## Layout & hot-path notes

- Per frame: `stepFluid` (label-if-dirty → gas → lift → rain inject → particles → liquid). `labelAirRegions` runs only when `world.airDirty` (mat change or free-liquid crossing `LIQ_DRAW`); `stepLiquid` re-labels mid-tick if particles / lift dirtied topology again.
- `airDirty` / `gasGeomDirty` are set together on occupancy flips — not every liquid mass move. Boyle overlap scan is skipped when there are no sealed regions.
- Terrain `solid` / `outline` and fluid grids share flat `y * W + x` indexing (no row arrays).
- Terrain outline glyphs are precomputed at generate time; compose only blits.
- World scratch lives on `world.scratch` (typed arrays reused across ticks). BFS uses a reused `floodQ` number array (`floodClear` / `floodPush`).
- Gas nozzle spans / blocked mask rebuild only when `gasGeomDirty`; velocity buffers swap with scratch (no per-tick `.set` copy). Blocked cells are zeroed in the velocity pass — no `nextU*.fill(0)`.
- Gas nozzle spans are precomputed in O(WH) column/row runs — do not re-walk per cell.
- Air-region labels double-buffer `regionId` via `scratch.prevRegionId`; regions are pooled + id-indexed; Boyle overlap uses a packed-key Map (sealed only).
- Open-air thermo in `stepGas` / `pressureAt` is closed-form `P_ATM+ATM_HYDRO·y` (no region object read).
- Global wind is evaluated once per gas tick; height shear is applied per row; `maxUpdraft` gates `liftLiquidByWind`.
- `stepLiquid` keeps a per-column liquid-pressure cache (refreshed after each vertical transfer — no second full-WH refill before horizontal). Diagonal settle still uses live `liquidPressureAt` because the neighbor column may not have been refreshed yet this tick.
- Hydraulic equalize surfaces are SoA scratch; BFS uses a generation stamp on `liqHydroVisit` (no whole-grid `dist.fill`); surfaces stay contiguous by component (no `Map`).
- Material rebuild is keyed by a packed int (`matKey`); hold frames skip it.
- Body cells are parallel `Uint8Array`s on `BODY` (`x` / `y` / `d`), not object lists.
- Particles are SoA pools (`particles.x/y/vx/vy/life/amt` + `count`); no per-tick object alloc.
- Compose paints every view cell in one pass (no `ch.fill`/`fg.fill`); ANSI joins same-SGR glyph runs; torch path quantizes lift and caches truecolor SGR; ripple-only frames skip `sampleLight` outside ring pads; `renderGrid(Cell[][])` is a thin adapter.
- Player `paint` homes the cursor only (`\x1b[H`) — frame is full-viewport, no Erase display.
- Pointer wind drive buffers are filled only while the right button is down (`driveUx`/`driveUy` omitted otherwise); clears only the previous dirty rectangle (reused box object); stroke segments are pooled + swap-removed on expiry.
- Pointer light (`state.light`): SGR mouse via `consumeStdin`; `gesture/light.mjs` arms a torch after `TORCH_DELAY` frames of hold, then `torchBlend` eases 0→1 over `TORCH_FADE` (compose: ambient dim + quadratic radial falloff scale with eased blend; cell aspect `hypot(dx, 2·dy)`). Release fades blend out (no ripple); re-press mid fade-out resumes without re-waiting `TORCH_DELAY`. Faster release before the torch arms spawns a high-brightness expanding ring (`rippleFalloff`) that ages out — no ambient dim.
- Pointer wind (`state.wind`): right-button gesture in `gesture/wind.mjs`; each tick paints `driveUx`/`driveUy` scratch into `stepGas` (stroke trail + tornado vortex: clockwise tangential + updraft + inflow). Drag speed scales stroke amplitude; vortex strength grows with hold time and clears on release. Tangential `ty` uses the full `(rx/r)·amp` (not ×½) so right-side downwash cannot form a hover attractor under gravity — rain mean stays at the cursor. Strong upward gas scoops free-liquid puddles into particles (`liftLiquidByWind`); particle vertical drag rises with |gas| so rain can orbit inside the vortex.

## Material standard

Static / growing icon + terrain write the material grid (particles do not rewrite the ICON string). Glyphs below are the *authored* look; free liquid redraws via `waterChar` from amount + liquid velocity (still / fall / slant sets below). Hanging condensation under soil ceilings draws as `.` / `,` / `*` / `o`.

| Glyph / mat | Region | Behavior |
| --- | --- | --- |
| `@` (`BODY`) | Upper body | Impact shell: rain/particles splash then vanish — no merge, no flood. |
| `:` (visual) | Pillars | Compose-only jet. **Does not write material** — liquid & particles pass through freely. |
| `@` (`POOL`) | Base slabs | Pool: absorb, then leak with splash to the next lower slab; bottom slab runoff deposits free liquid on nearby ground. |
| `>` / `<` (`SLOPE_*`) | Base soft edges | 45° splash faces (`>` one side, `<` opposite). |
| surface (`HORIZON`) | Ground top | Soil: impact / standing free liquid raise moisture (dry soil drinks fastest); saturated cells shed free liquid into the air cell above. Pedestal span stays land until POOL overwrites — ungrown base columns still join the shoulders. |
| terrain fill (`SOLID`) | Foundation | Soil (same moisture field as HORIZON). Impenetrable to free liquid / particles except via seepage + ceiling drip. Under the icon only the crust layer is required; deeper cells may be caves. |
| `SEAL` | Tests / vessels | Impermeable barrier: blocks liquid like rock, stores no moisture, no seepage. |
| empty (`AIR`) | Atmosphere / caves | Air; liquid & particles that hit world edges are discarded. Gas velocity lives here. |

Open-stage rule: columns whose base slab has not grown yet do **not** splash — rain keeps falling through empty cells until it hits existing mat, horizon, or leaves the world.

Falling water (rain particles **and** free liquid) uses `waterChar` from **amount × liquid/droplet velocity** (never gas wind). High momentum: `/` `∕` · `\` `∖` · `-`. Low momentum diagonal: `‚´′…` / `‵‛…`. Pure fall: `|¦‖⁞⁚⁝.`. Still pools: `‥…~⁓–`. Grid liquid velocity is `liqVx`/`liqVy` from mass transfers; particles use `particles.vx[i]`/`particles.vy[i]`.

Compose priority (top wins): splash/rain particles → soft icon edges (`.` / `..`) → body-pool `@` / free-liquid water glyphs → hanging drip under soil → pillars `:` → terrain outline.

## Terrain invariants

- Surface is **pedestal-anchored**: flat land under the icon base, land shoulders on both outer ends, free Terraria-style walk outward.
- Ungrown base columns keep `HORIZON` until `POOL`/`SLOPE_*` overwrite — terrain and icon join without a post-hoc hole.
- Under the icon: the crust cell at surface/`baseY` is soil; below that the generator may leave caves (no packed solid fill).
- ≥30% of view columns have land thickness ≥ ¼ screen height (`TALL_LAND_FRACTION` / `TALL_LAND_HEIGHT_FRAC`).
- Resize is pedestal-relative: retained cells and dynamics shift intact with the icon; shrinking crops, while expansion generates only exposed cells from the persistent seed. New soil starts saturated and runs `RESIZE_WEATHER_TICKS` settling steps.

## Physics invariants

- **One pressure language**: gas thermo `pressureAt`, liquid hydro `liquidPressureAt`, gas dynamic `staticPressureAt = P − ½ρu²`. Free-liquid mass moves via Torricelli `pressureMove` / free-surface `sheetMove` (`flow.mjs`).
- Open air regions: region mean `pressure = P_ATM`; cell `pressureAt = P_ATM + ATM_HYDRO·y` (y↓ → P↑).
- Sealed regions: Boyle mean `pressure ≈ gasAmount / airCells` (isothermal ideal gas at fixed T) plus hydrostatic `ATM_HYDRO·(y − yMean)` so the spatial average stays Boyle; gas mass transfers by cell overlap when topology splits/merges.
- `RHO_AIR` (~`ATM_HYDRO`) is the dynamic density for `½ρu²`; `RHO_G` is liquid column head — keep `RHO_AIR ≪ RHO_G` so Bernoulli dynamic head does not rival liquid depth.
- Gas velocity (`gasUx` / `gasUy`): open air tracks a time-varying global wind with power-law height shear (stronger aloft). Global wind is pink-ish fBm (synoptic / meso / micro) plus intermittent asymmetric gust pulses — autocorrelated and irregular, not layered sines. Continuity (`A·v`) speeds flow through duct throats (wind-tunnel nozzle). Wall slip zeros inflow into solids. Bernoulli static field `P₀ − ½ρu²` (`RHO_AIR`) drives neighbor ΔP acceleration (`GAS_DP_DRIVE`). No 2D ∇·u=0 projection (pointer vortices / updrafts are intentional sources). Optional local `driveUx`/`driveUy` (pointer stroke / tornado vortex) add into the per-cell target before blend. Rain particles drag toward local gas (`GAS_DRAG`; vertical drag scales up with |gas| so vortices can suspend droplets). Strong upward gas over free liquid lifts puddles into particles (`liftLiquidByWind`). Free-surface sheets also take a light downwind push from `gasUx`. Glyphs use the particle's resulting velocity, not the gas field directly.
- Free-liquid hydrostatic pressure: `liquidPressureAt = P_air(surface) + RHO_G·depth`. Submerged side holes / deep edge vents move mass `∝ √(ΔP/ρg)` (Torricelli); free-surface sheet flow equalizes by fill level only (no fake surface jet). Sealed gas with `P > liquid P` blocks invasion and can push adjacent liquid away.
- Grid liquid velocity (`liqVx` / `liqVy`): updated from mass transfers each `stepLiquid` (EMA); drives free-liquid glyphs so calm puddles stay on still marks.
- Communicating vessels: free surfaces of the same liquid component relax toward equal `φ = P/(ρg) - y` **along the liquid graph** (BFS from the lowest-φ surface — no teleport across disconnected air).
- `POOL` retains fill and spills / leaks into open air or the next slab when overfull; `BODY` is a liquid barrier (splash-only). Pillars are not materials.
- Soil moisture (`moisture`): gains from impacts and free liquid above with diminishing absorb rate as the cell wets (`soilAbsorbFactor`); rain hits only sink a fraction (`SOIL_HIT_ABSORB_FRAC`) so the rest sheets as free liquid. Seepage is slow enough that sustained rain forms visible surface puddles. Each tick shares a fraction sideways among soil neighbors, prefers transfer into soil below, and when below is air feeds underside `condense`. Neighboring condensation cells apply a noisy Matthew transfer (richer steals from poorer). Past `COND_DRAW` the air cell shows a droplet glyph; past `COND_DRIP` condensation becomes free liquid below and clears.
- `SEAL` is impermeable (no moisture) — use it in tests/vessels so soil absorption cannot drain free-liquid setups.
- Water mass lives in `liq + moisture + condense + particles` (`totalWorldWater`). Closed transfers conserve; intentional sinks are world-edge / bottom wipe / BODY impact vanish. Particle life expiry **deposits** back into the grid (pending overflow too).
- Material rebuild clears labels only; `releaseNonSoilWater` dumps moisture/condense from non-soil cells into free liquid (or the cell above) so POOL overwrite does not erase water.
- `exit` stops as soon as the icon is gone — no rain/liquid drain wait.

## Tests

```bash
fount test icon_anime --no-parallel
# or
fount test icon_anime:pure --no-parallel
```

Coverage: deterministic terrain glyphs/features, pedestal land shoulders, icon crust + caves below, tall-land quota (≥30% view cols ≥¼ screen), sealed-cavity compression (Boyle) + sealed hydrostatic stratification, U-tube leveling (graph φ), BODY splash (no flood), pillar pass-through, pool→slab/ground leak, `SEAL` impermeable fixtures, soil absorb (dry>wet) / seepage / Matthew condense / drip + mass conservation, sustained-rain surface puddles, open-air hydrostatic P(y), liquid column depth pressure + Torricelli √(ΔP) orifice drain, sealed gas pushback on liquid, gas wind time-variation + height shear, wind-tunnel continuity + Bernoulli static-P drop + ΔP suction drive, wall stagnation, particle gas drag + life-expire deposit, water glyphs by amount/liquid-velocity (still puddles vs high/low momentum slant), exit frame bound, resize terrain/dynamics preservation + new-soil weathering, ANSI frame size.
