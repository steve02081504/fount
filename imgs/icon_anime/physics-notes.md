# icon_anime physics & hot-path notes

Day-to-day map / hosting: [AGENTS.md](AGENTS.md). Read this when changing fluid, gravity, terrain, or frame paint.

## Tick order

`stepFluid`: label-if-dirty → gas → lift → thermal → rain inject → particles → liquid → bubbles → boundary.

`labelAirRegions` runs only when `world.airDirty` (mat change or free-liquid/melt crossing `LIQ_DRAW`). `stepLiquid` may re-label mid-tick if particles/lift dirty topology again. Set `airDirty` / `gasGeomDirty` together on occupancy flips — not on every liquid mass move. Skip Boyle overlap when there are no sealed regions.

## Layout / allocation

- Terrain `solid`/`outline` and fluid grids: flat `y * W + x` (no row arrays). Outline glyphs are precomputed; compose only blits.
- World scratch on `world.scratch` (typed arrays reused). BFS: reused `floodQ` (`floodClear` / `floodPush`).
- Gas nozzle spans / blocked mask rebuild only when `gasGeomDirty`; velocity buffers swap with scratch (no per-tick `.set`). Blocked cells zeroed in the velocity pass — no `nextU*.fill(0)`. Nozzle spans are O(WH) column/row runs — do not re-walk per cell.
- Air labels double-buffer `regionId` via `scratch.prevRegionId`; regions pooled + id-indexed; Boyle overlap = packed-key Map (sealed only).
- `stepLiquid` keeps a per-column liquid-pressure cache (refresh after each vertical transfer). Diagonal settle still uses live `liquidPressureAt` (neighbor column may be stale this tick).
- Hydraulic equalize: SoA scratch; generation stamp on `liqHydroVisit` (no whole-grid `dist.fill`); surfaces contiguous by component (no `Map`).
- Material rebuild keyed by packed `matKey`; hold frames skip it. `BODY` cells are parallel `Uint8Array`s (`x`/`y`/`d`). Particles are SoA pools.
- Compose: one pass over view cells; ANSI joins same-SGR runs; torch quantizes lift + caches truecolor SGR; ripple-only frames skip `sampleLight` outside ring pads. Player `paint` homes cursor only (`\x1b[H`) — full viewport, no Erase display.
- Pointer wind: fill `driveUx`/`driveUy` only while right button down; clear previous dirty rect only; stroke segments pooled.

## Gravity & boundaries

- Particles: `world.gravity` unit × `mag`; gravity-aligned speed capped (preserves tangential vortex speed).
- Grid: `axis`/`sign` quantize; hydrostatic depth and settle use that axis. Terrain/icon stay screen-anchored.
- Rain spawn: `rainEdgeWeights` / `pickRainEdge`; gravity-down weight always 0; L/R keep a small base under default down.
- Down edge after `LAVA_ONSET_FRAMES` (~13s at 24fps) of screen-down: infinite lava, rim `T_MAX`; water wiped (not counted).
- Up edge: infinite rain (not counted); melt absorbed into `{units,heat,lastTemp}` and regurgitated when gravity returns screen-down.
- Side edges: index wrap on the axis perpendicular to gravity (world margin, not viewport).

## Terrain

- Pedestal-anchored: flat under icon base, land shoulders on both outer ends, free walk outward.
- Under icon: crust at surface/`baseY` is soil; deeper cells may be caves.
- ≥30% of view columns have land thickness ≥ ¼ screen height (`TALL_LAND_FRACTION` / `TALL_LAND_HEIGHT_FRAC`).
- Resize is pedestal-relative: retained cells + dynamics (incl. `melt`/`temp`) shift with the icon; shrink crops; expand generates only exposed cells from the persistent seed. New soil starts saturated; temps BFS-decay from retained melt. `RESIZE_WEATHER_TICKS` includes thermal + liquid settle.

## Pressure / density

- Gas thermo `pressureAt`, liquid hydro `liquidPressureAt`, gas dynamic `staticPressureAt = P − ½ρu²`. Free liquid moves via Torricelli `pressureMove` / free-surface `sheetMove` (`flow.mjs`), scaled by `viscGain(visc)`.
- `rhoOf(substance, temp)` → `viscOf(rho)`. Gas low-rho; water mid; rock/lava continuum (hotter → lighter → thinner). Cold rock = soil (`SOLID`/`HORIZON` are cache tags flipped at `T_LIQUIDUS`/`T_SOLIDUS`).
- Open air: region mean `P_ATM`; cell `pressureAt = P_ATM + ATM_HYDRO·depth` (`depth = gravityDepth`, default `y`).
- Sealed: Boyle mean `≈ gasAmount / airCells` plus hydrostatic `ATM_HYDRO·(depth − depthMean)` so spatial average stays Boyle; mass transfers by cell overlap on topology split/merge. Evaporation injects steam into the local region.
- Keep `RHO_AIR ≪ RHO_G` so Bernoulli dynamic head does not rival liquid depth (`RHO_AIR` ~ `ATM_HYDRO`).

## Gas / wind

- Open air tracks global wind (fBm + intermittent gust pulses) with power-law height shear. Continuity (`A·v`) speeds duct throats. Wall slip zeros inflow into solids. Bernoulli `P₀ − ½ρu²` drives neighbor ΔP (`GAS_DP_DRIVE`). No 2D ∇·u=0 projection (pointer vortices/updrafts are intentional sources).
- Optional `driveUx`/`driveUy` (stroke / tornado) add into per-cell target before blend. Vortex: clockwise tangential + updraft + inflow; tangential `ty` uses full `(rx/r)·amp` (not ×½) so right-side downwash cannot form a hover attractor under gravity.
- Rain particles drag toward local gas (`GAS_DRAG`; vertical drag scales with |gas|). Strong upward gas over free liquid → `liftLiquidByWind`. Free-surface sheets take a light downwind push from `gasUx`. Glyphs use particle velocity, not the gas field.

## Liquid / melt / soil

- `liquidPressureAt = P_air(surface) + RHO_G·depth`. Submerged orifices: Torricelli `∝ √(ΔP/ρg)`. Free-surface sheets equalize by fill level only. Sealed gas with `P > liquid P` blocks invasion and can push liquid away.
- Melt shares transport primitives with per-cell viscosity; buoyancy swaps along gravity when the downslope neighbor is lighter.
- `liqVx`/`liqVy`: EMA from mass transfers each `stepLiquid` — drives free-liquid glyphs.
- Communicating vessels: relax `φ = P/(ρg) - depth` along the liquid graph (BFS from lowest-φ surface — no teleport across disconnected air).
- `POOL` retains fill and spills/leaks; `BODY` is splash-only barrier; pillars are not materials.
- Soil: absorb diminishes as cell wets (`soilAbsorbFactor`); rain hits sink only `SOIL_HIT_ABSORB_FRAC`. Seepage slow enough for surface puddles. Sideways share + prefer below; air below → underside `condense`; Matthew transfer between condensation cells; `COND_DRAW` / `COND_DRIP` thresholds. Heating evaporates moisture before melt.
- Material rebuild clears labels only; `releaseNonSoilWater` dumps moisture/condense from non-soil into free liquid so `POOL` overwrite does not erase water.
- `exit` stops when the icon is gone — no rain/liquid drain wait.

## Pointer light

Left: after `TORCH_DELAY` frames of hold, `torchBlend` eases over `TORCH_FADE` (ambient dim + quadratic radial falloff; cell aspect `hypot(dx, 2·dy)`). Release fades out (no ripple); re-press mid fade-out resumes without re-waiting delay. Faster release before arm → expanding ripple ring, no ambient dim.
