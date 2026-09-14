# Iconography

Icons are part of the interface's voice. fount keeps them monochrome, themeable,
and consistent by routing **all interface chrome through Iconify** and reserving
emoji for user content.

## The rule

- **Interface chrome → Iconify.** Buttons, nav, toolbars, menus, empty states,
  status, badges, particles. Never an emoji as a control or indicator.
- **User content → emoji is fine.** Message bodies, posts, reactions, stickers,
  and the emoji picker itself. That is the one place emoji belong.

This is a hard rule, not a preference. It keeps chrome legible on every theme
(emoji carry their own fixed colours and cannot follow `currentColor`) and keeps
the visual language coherent.

## Two delivery mechanisms

### 1. Mask system (page-local, CSS-driven)

Used by the social shell. A single `.icon` class paints the current colour
through an SVG mask:

```css
.icon {
	display: inline-block;
	width: 1.35rem;
	height: 1.35rem;
	background: currentColor;
	mask-image: var(--icon);
	-webkit-mask-image: var(--icon);
	mask-size: contain;
	mask-repeat: no-repeat;
	mask-position: center;
	flex-shrink: 0;
}
.icon-home { --icon: url("https://api.iconify.design/mdi/home-outline.svg"); }
```

Usage: `<span class="icon icon-home" aria-hidden="true"></span>`.

Add a glyph by appending one `.icon-name` rule. No HTML change, no inline SVG.

### 2. `text-icon` + `svgInliner` (shared components)

For components outside the social shell, an `<img>` from the Iconify CDN is
inlined by `svgInliner` so it inherits `currentColor`:

```html
<img src="https://api.iconify.design/mdi/check.svg" class="text-icon" alt="" />
```

Mark user-controlled images (avatars, media) `svg-inliner-ignore` — inlining
untrusted SVG would activate scripts. See the
[pages guide](../../AGENTS.md#components--utilities).

## Choosing a glyph

- Prefer the **MDI** set (`mdi/…`) — it is the de-facto set across shells.
- Outline for default, filled for active/selected states, and swap between them
  with [icon swap](motion-patterns.md#pattern-catalogue).
- One glyph per concept. Do not use two metaphors for the same action.
- Provide an accessible name on the control (`aria-label`, `data-i18n`, or a
  visible `.sr-only`); mark purely decorative icons `aria-hidden="true"`.

## Particles and reactions

Floating hearts, likes, and confetti are chrome, so they use Iconify glyphs, not
emoji characters:

```js
import { burst } from '/scripts/motion/index.mjs'
burst(mediaHost, { glyphClass: 'icon icon-like' })   // social mask class
```

The old emoji-based `playHeartAnim('👍')` pattern is retired. If a particle needs
a glyph the mask system does not have, add an `.icon-*` rule — never a raw emoji.

## Do / don't

| Do | Don't |
| --- | --- |
| `<span class="icon icon-like" aria-hidden="true"></span>` | `👍` inside a button |
| `<img src="…/mdi/check.svg" class="text-icon">` | a hand-written `<svg><path …/></svg>` |
| Iconify glyph for a like burst | emoji for a like burst |
| `currentColor`-driven colour | fixed emoji colour |

Hand-written inline SVG is rejected by the `no_manual_svg` check; emoji in chrome
is caught at runtime by the `[test:emoji]` page-watch (visible text + `aria-label`,
`user-content=""` / `language-check-ignore` exempt). When adding UI, run the Static
checks and the frontend tests before opening a PR.
