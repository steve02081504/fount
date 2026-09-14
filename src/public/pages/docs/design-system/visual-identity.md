# fount visual identity

This is the canonical description of how fount's interface should look and feel.
It applies to every browser-served surface under `src/public/` — full pages,
shells, and shared components. Read it before writing CSS or motion.

The identity is not a fixed skin. fount ships DaisyUI themes and user-authored
custom themes, so the *system* must stay theme-neutral: it describes structure,
hierarchy, motion, and restraint — never a specific palette.

## Principles

1. **Theme-native.** Colour, radius, and border width come only from DaisyUI
   theme variables (`--color-*`, `--radius-*`, `--border`). A surface that looks
   right on `light` must still work on `cyberpunk` and on a user's custom theme.
   Never hardcode a colour, a radius, or a border pixel width.
2. **Spatial, not flat.** Interfaces have depth: layered surfaces, elevation
   shadows, and occasional translucency signal what floats above what. Depth is
   quiet — a hint of separation, not a drop-shadow festival.
3. **Calm by default, expressive on intent.** Resting UI is low-contrast and
   still. Rich motion, colour, and scale appear only as a response to focus,
   hover, or an explicit action. Nothing animates just to be noticed.
4. **Motion is feedback.** Every transition answers a question the user already
   had: *did it open? did it save? where did I go?* Motion that answers nothing
   is removed.
5. **Iconify chrome, never emoji.** Interface icons come from the Iconify CDN and
   inherit `currentColor`. Emoji belong to user content only.

## Surfaces and elevation

Three surface levels exist, mapped to DaisyUI base colours through semantic
tokens (see [tokens.md](tokens.md)):

- **base** — page background, `--color-base-100` via `--surface-elevated`.
- **raised** — cards, panels, sidebars: `--surface`.
- **hover / sunken** — interactive feedback and wells: `--surface-hover`,
  `--surface-sunken`.

Elevation is expressed with `--shadow-sm` / `--shadow-md` / `--shadow-lg`.
Use the smallest shadow that communicates the layer. A resting card normally has
no shadow; shadow appears on hover or when a surface detaches (modal, popover,
sticky bar).

### Glass

Translucency (`backdrop-filter` + a `color-mix` background) is reserved for
chrome that must stay legible while content scrolls underneath: sticky headers,
floating toolbars, and modal backdrops. It is never used as a full-page
treatment, because it fights custom themes and hurts contrast.

## Typography

Type is driven by font tokens, so a font scheme can replace the whole stack without
touching component CSS:

- `--font-body` — default UI and body text.
- `--font-heading` — display headings (defaults to `--font-body`).
- `--font-code` — monospace content.

The scale is deliberately compact; hierarchy comes from weight and colour, not
from dramatic size jumps:

| Role | Size | Weight |
| --- | --- | --- |
| Page title | `1.25rem` | 800 |
| Section title | `0.95–1.1rem` | 700–800 |
| Body | `0.95–1rem` | 400 |
| Meta / caption | `0.8–0.85rem` | 400–600 |

Body line-height is `1.5–1.6`. Muted text is a `color-mix` fade of
`--color-base-content`, never a hardcoded grey.

## Shape

Radius is fully theme-owned. Use the DaisyUI classes/variables
(`rounded-box`, `rounded-field`, `rounded-selector`, `--radius-box`,
`--radius-field`) and never a literal length. The one deliberate exception is
documented decorative borders (avatar rings, emphasis bars), which carry an
above-line `/* theme-radius-ignore */`.

## Do / don't

| Do | Don't |
| --- | --- |
| `color-mix(in srgb, var(--color-base-content) 8%, transparent)` | `rgba(0,0,0,.08)` |
| `var(--radius-box)` / `rounded-box` | `border-radius: 12px` |
| `var(--shadow-md)` | `box-shadow: 0 8px 24px #0003` |
| Iconify `<span class="icon …">` | an emoji in a button |
| `var(--duration-hover)` | `transition: all .2s` |
| Animate `transform` / `opacity` | animate `height` / `margin` |

Enforcement is automated — see the [checks guide](../../../../scripts/checks/AGENTS.md).
