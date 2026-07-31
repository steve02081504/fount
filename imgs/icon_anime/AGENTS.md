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
| `terrain.mjs` | Terraria-style surface + noise caves + U-tube/chamber templates |
| `fluid_engine.mjs` | Particles, grid liquid, air-region pressure (Boyle), hydraulic equalization |
| `player.mjs` | TUI playback, keyboard, `stdout` resize |

## Physics invariants

- Open air regions: `pressure = P_ATM`.
- Sealed regions: `pressure ≈ gasAmount / airCells` (isothermal Boyle); gas mass transfers by cell overlap when topology splits/merges.
- Communicating vessels: free surfaces of the same liquid component relax toward equal `φ = P/(ρg) - y`.
- `exit` stops as soon as the icon is gone — no rain/liquid drain wait.

## Tests

```bash
fount test icon_anime --no-parallel
# or
fount test icon_anime:pure --no-parallel
```

Coverage: deterministic terrain glyphs/features, sealed-cavity compression, U-tube leveling, exit frame bound, resize state preserve, ANSI frame size.
