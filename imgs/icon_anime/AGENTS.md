---
description: ASCII fountain logo animation — terrain, fluid pressure, gas wind, TUI player
globs: imgs/icon_anime/**
alwaysApply: false
---

# icon_anime

Standalone terminal animation for the fount fountain logo.

## Run

```bash
deno run --allow-scripts --allow-all -c deno.json imgs/icon_anime/index.mjs
```

Controls: Space pause, `[` / `]` speed, Ctrl+C exit (icon teardown, then quit).
Player uses the alternate screen buffer (`1049h`/`1049l`) so exit restores the pre-start scrollback and cursor row.

## Modules

| Path | Role |
| --- | --- |
| `index.mjs` | CLI entry + public re-exports |
| `icon.mjs` | Packed silhouette, pillars, body growth order (typed arrays) |
| `scene.mjs` | Anim state, materials, rain, pool leak, enter/hold/exit |
| `compose.mjs` | Frame paint + ANSI `renderBuffers` / `renderGrid` |
| `player.mjs` | TUI playback, keyboard, `stdout` resize; alt-screen enter/leave |
| `terrain.mjs` | Pedestal-anchored surface + noise caves + U-tube/chamber templates |
| `hash.mjs` | Shared `hash01` (terrain + fluid) |
| `fluid/` | Particles, grid liquid, soil, Boyle air regions, gas wind, glyphs |

### `fluid/`

| File | Role |
| --- | --- |
| `index.mjs` | Barrel re-exports |
| `mat.mjs` | `MAT` enum, flags LUT, soil/liquid constants |
| `world.mjs` | Grid alloc, scratch buffers, mat/liq/moisture helpers |
| `gas.mjs` | Air regions, wind, `stepGas` |
| `liquid.mjs` | Gravity / side flow / soil / hydraulic `stepLiquid` |
| `particles.mjs` | Rain/splash particles + gas drag |
| `glyphs.mjs` | `waterChar` / `liquidChar` / `dripChar` |

## Layout & hot-path notes

- Terrain `solid` and fluid grids share flat `y * W + x` indexing (no row arrays).
- World scratch lives on `world.scratch` (typed arrays reused across ticks).
- Gas nozzle spans are precomputed in O(WH) column/row runs — do not re-walk per cell.
- Air-region labels double-buffer `regionId` via `scratch.prevRegionId`.
- Material rebuild is keyed by a packed int (`matKey`); hold frames skip it.
- Body cells are parallel `Uint8Array`s (`bodyX` / `bodyY` / `bodyD`), not object lists.
- Compose paints into reused `frameCh`/`frameFg` buffers; `renderGrid(Cell[][])` is a thin adapter.

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

Falling water (rain particles **and** free liquid) uses `waterChar` from **amount × liquid/droplet velocity** (never gas wind). High momentum: `/` `∕` · `\` `∖` · `-`. Low momentum diagonal: `‚´′…` / `‵‛…`. Pure fall: `|¦‖⁞⁚⁝.`. Still pools: `‥…~⁓–`. Grid liquid velocity is `liqVx`/`liqVy` from mass transfers; particles use `p.vx`/`p.vy`.

Compose priority (top wins): splash/rain particles → soft icon edges (`.` / `..`) → body-pool `@` / free-liquid water glyphs → hanging drip under soil → pillars `:` → terrain outline.

## Terrain invariants

- Surface is **pedestal-anchored**: flat land under the icon base, land shoulders on both outer ends, free Terraria-style walk outward.
- Ungrown base columns keep `HORIZON` until `POOL`/`SLOPE_*` overwrite — terrain and icon join without a post-hoc hole.
- Under the icon: the crust cell at surface/`baseY` is soil; below that the generator may leave caves (no packed solid fill).
- ≥30% of view columns have land thickness ≥ ¼ screen height (`TALL_LAND_FRACTION` / `TALL_LAND_HEIGHT_FRAC`).

## Physics invariants

- Open air regions: `pressure = P_ATM`.
- Sealed regions: `pressure ≈ gasAmount / airCells` (isothermal Boyle / ideal gas at fixed T); gas mass transfers by cell overlap when topology splits/merges.
- Gas velocity (`gasUx` / `gasUy`): open air tracks a time-varying global wind with power-law height shear (stronger aloft). Global wind is pink-ish fBm (synoptic / meso / micro) plus intermittent asymmetric gust pulses — autocorrelated and irregular, not layered sines. Continuity (`A·v`) speeds flow through duct throats (wind-tunnel nozzle). Wall slip zeros inflow into solids. Bernoulli proxy: `staticPressureAt = P₀ − ½ρu²` (faster → lower static P). Rain particles drag toward local gas (`GAS_DRAG`); glyphs use the particle's resulting velocity, not the gas field directly.
- Grid liquid velocity (`liqVx` / `liqVy`): updated from mass transfers each `stepLiquid` (EMA); drives free-liquid glyphs so calm puddles stay on still marks.
- Communicating vessels: free surfaces of the same liquid component relax toward equal `φ = P/(ρg) - y`.
- `POOL` retains fill and spills / leaks into open air or the next slab when overfull; `BODY` is a liquid barrier (splash-only). Pillars are not materials.
- Soil moisture (`moisture`): gains from impacts and free liquid above with diminishing absorb rate as the cell wets (`soilAbsorbFactor`); rain hits only sink a fraction (`SOIL_HIT_ABSORB_FRAC`) so the rest sheets as free liquid. Seepage is slow enough that sustained rain forms visible surface puddles. Each tick shares a fraction sideways among soil neighbors, prefers transfer into soil below, and when below is air feeds underside `condense`. Neighboring condensation cells apply a noisy Matthew transfer (richer steals from poorer). Past `COND_DRAW` the air cell shows a droplet glyph; past `COND_DRIP` condensation becomes free liquid below and clears.
- `SEAL` is impermeable (no moisture) — use it in tests/vessels so soil absorption cannot drain free-liquid setups.
- Grid water mass (`liq + moisture + condense`) is conserved under closed transfers — no creating/destroying mass except intentional world-edge / bottom sinks.
- Material rebuild clears labels only; `releaseNonSoilWater` dumps moisture/condense from non-soil cells into free liquid (or the cell above) so POOL overwrite does not erase water.
- `exit` stops as soon as the icon is gone — no rain/liquid drain wait.

## Tests

```bash
fount test icon_anime --no-parallel
# or
fount test icon_anime:pure --no-parallel
```

Coverage: deterministic terrain glyphs/features, pedestal land shoulders, icon crust + caves below, tall-land quota (≥30% view cols ≥¼ screen), sealed-cavity compression (Boyle), U-tube leveling, BODY splash (no flood), pillar pass-through, pool→slab/ground leak, `SEAL` impermeable fixtures, soil absorb (dry>wet) / seepage / Matthew condense / drip + mass conservation, sustained-rain surface puddles, gas wind time-variation + height shear, wind-tunnel continuity + Bernoulli static-P drop, wall stagnation, particle gas drag, water glyphs by amount/liquid-velocity (still puddles vs high/low momentum slant), exit frame bound, resize state preserve, ANSI frame size.
