# Design tokens

Semantic tokens are the contract between the theme layer and every component.
They live in the theme library
([`theme/tokens.css`](../../scripts/theme/tokens.css)) — imported globally by
`base.css` — and resolve to DaisyUI theme variables, so they follow any built-in
or custom theme automatically.

There is **no prefix by design.** The context where a token is used already
proves its ownership; a `--fount-` / `--social-` prefix would only be noise.
Names are short and semantic.

## Layering

```
DaisyUI theme vars      --color-base-200, --radius-box, --border, …
        ↓
fount semantic tokens   --surface, --text-muted, --shadow-md, --duration-open, …
        ↓
component-local vars    page/shell lookups (e.g. --nav-item-h) — sparing
```

- Components consume **semantic tokens**, not raw DaisyUI variables, whenever a
  semantic token exists.
- Component-local variables are fine for layout constants (widths, offsets) but
  must not re-invent colour, radius, border, or shadow.
- Theme authors override the DaisyUI layer; they should not need to know about
  component internals.

## Surfacing

| Token | Resolves to | Use for |
| --- | --- | --- |
| `--surface` | `--color-base-200` | raised cards, panels, sidebars |
| `--surface-elevated` | `--color-base-100` | the page background / top layer |
| `--surface-hover` | `--color-base-300` | hover and pressed states |
| `--surface-sunken` | mix toward `base-300` | wells, inset tracks |

## Text

| Token | Resolves to | Use for |
| --- | --- | --- |
| `--text` | `--color-base-content` | default body text |
| `--text-muted` | `base-content` at 68% | secondary text, meta, handles |
| `--text-subtle` | `base-content` at 50% | placeholders, disabled hints |

## Borders

| Token | Resolves to | Use for |
| --- | --- | --- |
| `--border-color` | `base-content` at 8% | default hairlines |
| `--border-strong` | `base-content` at 14% | emphasis dividers, focused inputs |

Border **width** still comes from `--border` (DaisyUI). These tokens only choose
the colour.

## Elevation

| Token | Value | Use for |
| --- | --- | --- |
| `--shadow-sm` | soft, 8px spread | raised rows, chips |
| `--shadow-md` | medium, 24px spread | hovered cards, popovers |
| `--shadow-lg` | large, 48px spread | modals, floating panels |

All shadows are built from `color-mix(in srgb, var(--color-base-content) …,
transparent)`, so they tint with the theme instead of assuming black.

## Motion

| Token | Value | Meaning |
| --- | --- | --- |
| `--duration-hover` | `120ms` | hover in/out |
| `--duration-open` | `250ms` | dropdown / modal / popover open |
| `--duration-close` | `150ms` | the faster close |
| `--duration-stagger` | `40ms` | per-item list offset |
| `--ease-standard` | `cubic-bezier(.4,0,.2,1)` | general |
| `--ease-entrance` | `cubic-bezier(0,0,.2,1)` | enter |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | leave |
| `--ease-pop` | `cubic-bezier(.34,1.56,.64,1)` | entrance overshoot only |

Timing intent and the pattern catalogue live in
[motion-patterns.md](motion-patterns.md); hard rules in
[motion-notes.md](../motion-notes.md).

## Typography

| Token | Default | Use for |
| --- | --- | --- |
| `--font-body` | system UI stack | default text |
| `--font-heading` | `var(--font-body)` | display headings |
| `--font-code` | monospace stack | code, keys, ids |

These names intentionally avoid Tailwind's `--font-sans` / `--font-mono` theme
keys: the Tailwind browser runtime injects those into `:root` after `base.css`
and would silently win. `--font-body` / `--font-heading` / `--font-code` are
outside the Tailwind namespace and safe to own.

## Font schemes

Fonts are driven by **roles**, not by per-family classes: `--font-body` (body
text), `--font-heading` (display headings) and `--font-code` (code). A **font
scheme** maps those roles to concrete families, and a scheme is **bound to a
theme** — switching theme restores that theme's fonts.

- `theme/tokens.css` holds the role defaults (system stacks).
- [`theme/fonts.mjs`](../../scripts/theme/fonts.mjs) registers the schemes and
  applies the active one. Applied scheme declarations are inserted *before* the
  custom-theme stylesheet, so a **custom theme's own `--font-*` always wins**.
- The scheme choice is stored per theme (`theme_fonts` in `localStorage`) and is
  edited from the theme manager's font-scheme selector.

| scheme | roles | notes |
| --- | --- | --- |
| `system` | system stacks | default, zero network |
| `inter` | Inter / Inter + JetBrains Mono | neutral, modern |
| `geist` | Geist / Geist + Geist Mono | sharp, technical |
| `noto-sans-sc` | Noto Sans SC | CJK-optimised |
| `lxgw-wenkai` | LXGW WenKai | literary serif-ish CJK |

A scheme that needs a web font ships its stylesheet URL and the loader injects it
only while that scheme is active. A custom theme can instead declare its own
`@font-face` and `--font-*`; nothing couples fonts to colours.

## Adding a token

1. Define it once in the `:root` block of `theme/tokens.css`.
2. Resolve it to a DaisyUI variable or a `color-mix` of one — never a literal
   colour.
3. If it is a cross-page contract, list it in the `cssvar-external:` directive
   at the top of `theme/tokens.css` so the page-watch dead-variable scan does not
   flag it on routes that happen not to use it.
4. Document it in the tables above.
