# icon_anime physics & hot-path notes

Day-to-day map / hosting: [AGENTS.md](../AGENTS.md). Read this when changing fluid, gravity, terrain, or frame paint.

## `fluid/` layout

`mat`, `flow`, `components`, `world/` (`create` / `cells` / `depth`), `particle_pool`, `edges`, `boundary`, `thermal` (`cellRho` / `meltVisc`), `bubbles`, `gas/` (`regions` / `pressure` / `velocity`), `liquid/` (`index` orchestration, `pressure` hydrostatic column, `water`, `lava`, `transport` Stokes kernel, `hydraulic` φ relax), `soil`, `particles`, `step` (`stepFluid`, `stepResizeWeather`), `glyphs`. Production deep-links these files; `fluid/index.mjs` is the test/public barrel.

## Tick order

`stepFluid`: label-if-dirty → gas → lift → thermal → rain inject → particles → liquid → bubbles → boundary.

`stepLiquid`: water → soil → commit liqV → hydraulic φ (own flow scratch) → lava → melt hydraulic φ → buoyancy.

`labelAirRegions` runs only when `world.airDirty` (mat change or condensed fill crossing `LIQ_DRAW`). Occupancy is `cellFill = liq+melt`; `isCondensed` / `cellRoom` enforce volume exclusivity. `stepLiquid` re-labels at entry if particles/lift dirtied topology again (not inside `water.mjs`). Set `airDirty` / `gasGeomDirty` together on occupancy flips — not on every liquid mass move. Skip Boyle overlap when there are no sealed regions.

## Hot-path allocation

- Terrain `solid`/`outline` and fluid grids: flat `y * W + x` (no row arrays).
- Hot-path geometry returns module-local reused shells — copy fields if holding across another call.
- Set `airDirty` / `gasGeomDirty` together on occupancy flips. Pointer wind: fill `driveUx`/`driveUy` only while right button down; clear previous dirty rect only.

## Gravity & boundaries

- Continuous `world.gravity = { gx, gy, mag }` (unit + particle accel). No 4-axis quantize.
- `gravityDepth = x·gx + y·gy − depth0` (cell-step space; depth0 = min of four corners). Default ĝ=(0,1) ⇒ depth = y. Visual `CELL_ASPECT` does **not** rescale depth (keeps RHO_G / ATM_HYDRO calibration) — it shapes neighbor û via `cellStepUnit` and torch/vortex radii.
- Face weights (`gravityDownWeights` / `Up`): ortho only, `w = û_phys·ĝ` — soil underside / free-surface / bubbles.
- Settle weights (`gravitySettleWeights`): ortho + diagonals when both |gx|,|gy| ≳ 0.28 — condensed-phase Torricelli. Side sheets: `gravitySideWeights` (⊥ĝ ortho). Edge out sinks use ambient pressure — do not `rhoAt`/`pressureAt` on OOB coordinates.
- Edge roles (`edgeRoles`): for outward normal n̂, `sink=max(0,n̂·ĝ)`, `source=max(0,−n̂·ĝ)`, `wrap=1−|n̂·ĝ|`. Cached on `(gx,gy)` for `neighborCoord` hot path.
- Exposure work: each tick `exposure[e] = max(0, exposure[e] + n̂_e·ĝ)`. Lava when `exposure[e] ≥ LAVA_ONSET_EXPOSURE` (312 under pure down = 13s@24fps). At 45°, two edges each accumulate cos45/frame → onset ≈ 13·√2 s. Condensed-phase transport never indexes OOB sink cells (outFrac uses ambient `P_ATM`); NaN there would permanently poison melt inject via `max(NaN, inject)`.
- Rain spawn uses `source` weights (gravity-down edge never rains). Composition bottom is never a rain sky (pedestal/lava edge). If bottom would be a source (`gy < 0`), **all** rain weights are zero — side rain under slight handheld tilt must not mint water while waiting for lava. Then lava on the sink edge after exposure. Side wrap uses `wrap`; particles pick wrap vs out with `hash01`.
- Absorb on source-weighted edges records `absorbGx/Gy`; regurgitate when `ĝ·absorbDir < threshold`, ejecting on current source edges.

## Terrain

- Pedestal-anchored: flat under icon base, land shoulders on both outer ends, free walk outward.
- Under icon: crust at surface/`baseY` is soil; deeper cells may be caves.
- ≥30% of view columns have land thickness ≥ ¼ screen height (`TALL_LAND_FRACTION` / `TALL_LAND_HEIGHT_FRAC`).
- Resize is pedestal-relative: retained cells + dynamics (incl. `melt`/`temp`) shift with the icon; shrink crops; expand generates only exposed cells from the persistent seed. New soil starts dry (wet fill would spring under inverted ĝ); temps BFS-decay from retained melt. `RESIZE_WEATHER_TICKS` includes thermal + liquid settle.

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

## Invariants

- **Volume exclusivity**: `cellFill = liq+melt`, `cellRoom = LIQ_FULL−fill`. Never stack phases past one cell.
- Water mass = `liq + moisture + condense + particles` (`totalWorldWater`); melt is separate. Closed transfers conserve; intentional sinks are world-edge / down-edge wipe / BODY impact.
- Gravity is a continuous unit vector everywhere. Terrain is **pedestal-anchored**; land occupancy is `world.land` (alias `terrain.solid`). New/expanded soil stays dry.
- Four edges hold fractional `sink/source/wrap` from `n̂·ĝ`. Lava onset is exposure work (not instant flip). Condensed-phase edge sinks must not read OOB cells (ambient `P_ATM`) — otherwise melt goes `NaN` permanently.
- Composition bottom never rains. Any ĝ into the bottom zeroes **all** rain weights — side rain alone would mint water forever under Infinity `rainUntil`.

## Pressure / density / viscosity ladder

- Gas thermo `pressureAt`, condensed hydro `condensedPressureAt` / `liquidPressureAt` (alias), gas dynamic `staticPressureAt = P − ½ρu²`. Free liquid moves via Torricelli `pressureMove` / free-surface `sheetMove` (`flow.mjs`), scaled by `viscGain(visc)`; submerged lateral `inertiaMove` feeds Stokes flux from `liqV` (not free-surface sheet — that fights φ vessels).
- `rhoOf(substance, temp)` → `viscOf(rho)`. Ladder:
  - `visc ≤ VISC_INERTIAL` → inertial (gas velocity field)
  - `VISC_INERTIAL < visc < VISC_SOLID` → Stokes mass flux (water / lava)
  - `visc ≥ VISC_SOLID` → frozen (rock / soil cache tags)
- Open air: region mean `P_ATM`; cell `pressureAt = P_ATM + ATM_HYDRO·depth`.
- Sealed: Boyle mean `≈ gasAmount / airCells` plus hydrostatic `ATM_HYDRO·(depth − depthMean)` so spatial average stays Boyle; mass transfers by cell overlap on topology split/merge. Evaporation injects steam into the local region (and heats local `temp`).
- Keep `RHO_AIR ≪ RHO_G` so Bernoulli dynamic head does not rival liquid depth (`RHO_AIR` ~ `ATM_HYDRO`).
- Shared structure: `components.mjs` labels air + liquid; `liquid/hydraulic.mjs` relaxes φ on the **water** graph then again on the **melt** graph (never cross-phase φ siphon). Boyle sealed-gas pressure lives in `gas/`. `liquid/transport.mjs` is the Stokes settle+sheet kernel for melt (per-cell visc; pools use condensed column, sub-`LIQ_DRAW` blobs use local fill head). Free water keeps a hydrostatic column in `liquid/pressure.mjs` + specialized settle/sheet/wind/gas-push in `liquid/water.mjs`.
- Volume: `cellRoom = LIQ_FULL − liq − melt`. `addMelt` spills displaced water to ortho neighbors before wipe/flash.

## Gas / wind

- Open air tracks global wind (fBm + intermittent gust pulses) along ĝ⊥ `(gy, −gx)` (default → +x) with power-law shear vs projected depth. Continuity (`A·v`) speeds duct throats. Wall slip zeros inflow into solids. Bernoulli `P₀ − ½ρu²` drives neighbor ΔP (`GAS_DP_DRIVE`). Weak Boussinesq: open-air target picks up `−ĝ·(T−T_AMB)`.
- After target blend: Jacobi `∇·u≈0` projection on non-driven fields (`holdVelocity` keeps the field for tests). **Pointer `driveUx/Uy` present → skip projection** (vortex/stroke are intentional sources).
- Optional `driveUx`/`driveUy` (stroke / tornado) add into per-cell target before blend. Vortex: clockwise tangential + updraft + inflow; tangential `ty` uses full `(rx/r)·amp` (not ×½) so right-side downwash cannot form a hover attractor under gravity.
- Rain particles drag toward local gas (`GAS_DRAG`; vertical drag scales with |gas|). Strong velocity against ĝ over free liquid → `liftLiquidByWind`. Free-surface sheets take a light downwind push from local gas. Glyphs use particle velocity, not the gas field.

## Liquid / melt / soil

- `condensedPressureAt = P_air(surface) + Σ ρ_cell·Δh` along −ĝ through `cellFill ≥ LIQ_DRAW` (density from `cellRho`, mass-weighted if both phases share a cell). Submerged orifices: Torricelli `∝ √(ΔP/ρg)`. Free-surface sheets equalize by fill level only. Sealed gas with `P > liquid P` blocks invasion and can push liquid away.
- Melt uses `transport.mjs` with per-cell viscosity; buoyancy swaps along weighted down when the downslope neighbor is lighter.
- `liqVx`/`liqVy` / `meltVx`/`meltVy`: EMA from **transport** mass transfers (φ equalize uses separate scratch flows so quasi-static hydraulics cannot amplify inertia). Melts use the same alphabet; viscosity only slows Stokes flux.
- Condensed-phase `stepPhaseTransport` settles **deep→shallow** along ĝ (no shallow→deep cascade that teleports melt to the floor in one tick).
- Buoyancy swaps only between occupied condensed cells (convection); free-fall into empty air is transport, so lava viscosity can lag water.
- Communicating vessels: relax `φ = P/(ρg) - depth` along the liquid graph (ortho BFS from lowest-φ surface — no teleport across disconnected air; diagonals stay out of the φ graph so platform puddles cannot siphon off a corner).
- Free-surface tension: sheet onto dry neighbors scaled by `ST_DRY_FRAC` (wet–wet full `sheetMove`) — beading without fighting φ.
- Particle deposit / wet hits write incident `vx,vy` into `liqVx`/`liqVy` via `impartLiquidMomentum` (mass-weighted); `commitWaterVelocity` EMA keeps a fraction.
- `POOL` retains fill and spills/leaks; `BODY` is splash-only barrier; pillars are not materials.
- Bubbles: each tick, sealed air cells fractionally exchange melt with the −ĝ neighbor (rate ∝ Δρ · `viscGain`); no period-3 teleport.
- Soil: absorb diminishes as cell wets (`soilAbsorbFactor`); rain hits sink only `SOIL_HIT_ABSORB_FRAC`. Seepage slow enough for surface puddles. Sideways share + prefer below (gravity-weighted); air below → underside `condense`; Matthew along ĝ⊥; `COND_DRAW` glyphs / full dump at `COND_DRIP` / `COND_WEEP_FRAC` weep below drip so split films cannot trap mass forever. When ĝ leaves an open underside, condense reabsorbs into moisture (excess spills to ortho air). Compose drips via `condenseDripSource` (gravity-up soil), not screen-Y. Heating evaporates moisture before melt.
- Thermal: mass cells conduct among mass only (air heat capacity ≪ rock); air cells conduct + upwind-advect with `gasU*`. Steam flash heats local air `temp`.
- Material rebuild clears labels only; `releaseNonSoilWater` dumps moisture/condense from non-soil into free liquid so `POOL` overwrite does not erase water.
- `exit` keeps stepping fluid while the icon tears down (`world.land` holds solidified soil); then `clearDynamics` + blank.

## Pointer light

Left: after `TORCH_DELAY` frames of hold, `torchBlend` eases over `TORCH_FADE` (ambient dim + quadratic radial falloff; cell aspect `hypot(dx, CELL_ASPECT·dy)`). Release fades out (no ripple); re-press mid fade-out resumes without re-waiting delay. Faster release before arm → expanding ripple ring, no ambient dim.
