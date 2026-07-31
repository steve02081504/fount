---
description: ASCII fountain logo animation — terrain, fluid pressure, TUI player
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

## Modules

| File | Role |
| --- | --- |
| `index.mjs` | Icon stages (`enter` / `hold` / `exit`), rain, compose, resize migration |
| `terrain.mjs` | Pedestal-anchored surface (land shoulders) + noise caves + U-tube/chamber templates |
| `fluid_engine.mjs` | Particles, grid liquid, air-region pressure (Boyle), hydraulic equalization |
| `player.mjs` | TUI playback, keyboard, `stdout` resize |

## Material standard

Static / growing icon + terrain write the material grid (particles do not rewrite the ICON string). Glyphs below are the *authored* look; free liquid may redraw cells as `~` / `≈` / `,` when flooded.

| Glyph / mat | Region | Behavior |
| --- | --- | --- |
| `@` (`BODY`) | Upper body | Impact shell: rain/particles splash then vanish — no merge, no flood. |
| `:` (visual) | Pillars | Compose-only jet. **Does not write material** — liquid & particles pass through freely. |
| `@` (`POOL`) | Base slabs | Pool: absorb, then leak with splash to the next lower slab; bottom slab runoff deposits free liquid on nearby ground. |
| `>` / `<` (`SLOPE_*`) | Base soft edges | 45° splash faces (`>` one side, `<` opposite). |
| surface (`HORIZON`) | Ground top | Solid top: splash + leave free liquid in the air cell above so it sheets/flows; absorb quota still shortens the hit. Pedestal span stays land until POOL overwrites — ungrown base columns still join the shoulders. |
| terrain fill (`SOLID`) | Foundation | Impenetrable solid. |
| empty (`AIR`) | Atmosphere / caves | Air; liquid & particles that hit world edges are discarded. |

Open-stage rule: columns whose base slab has not grown yet do **not** splash — rain keeps falling through empty cells until it hits existing mat, horizon, or leaves the world.

Compose priority (top wins): splash/rain particles → soft icon edges (`.` / `..`) → body-pool `@` / flooded liquid `~` → pillars `:` → terrain outline.

## Terrain invariants

- Surface is **pedestal-anchored**: flat land under the icon base, land shoulders on both outer ends, free Terraria-style walk outward.
- Ungrown base columns keep `HORIZON` until `POOL`/`SLOPE_*` overwrite — terrain and icon join without a post-hoc hole.
- ≥30% of view columns have land thickness ≥ ¼ screen height (`TALL_LAND_FRACTION` / `TALL_LAND_HEIGHT_FRAC`).

## Physics invariants

- Open air regions: `pressure = P_ATM`.
- Sealed regions: `pressure ≈ gasAmount / airCells` (isothermal Boyle); gas mass transfers by cell overlap when topology splits/merges.
- Communicating vessels: free surfaces of the same liquid component relax toward equal `φ = P/(ρg) - y`.
- `POOL` retains fill and spills / leaks into open air or the next slab when overfull; `BODY` is a liquid barrier (splash-only). Pillars are not materials.
- `exit` stops as soon as the icon is gone — no rain/liquid drain wait.

## Tests

```bash
fount test icon_anime --no-parallel
# or
fount test icon_anime:pure --no-parallel
```

Coverage: deterministic terrain glyphs/features, pedestal land shoulders, tall-land quota (≥30% view cols ≥¼ screen), sealed-cavity compression, U-tube leveling, BODY splash (no flood), pillar pass-through, pool→slab/ground leak, exit frame bound, resize state preserve, ANSI frame size.
