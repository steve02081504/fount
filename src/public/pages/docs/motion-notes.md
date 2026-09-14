# Motion notes

Fount has **no motion library** — page-local CSS transitions plus the shared page-transition helper. Rules below are distilled from the [transitions.dev](https://github.com/Jakubantalik/transitions.dev/tree/main/skills) skills, filtered to what this codebase actually uses.

Enforced by the `motion_hygiene` static check ([checks AGENTS](../../../scripts/checks/AGENTS.md)); judgment calls that a scanner cannot make live here.

## Page transitions

Use [`lib/viewTransition.mjs`](../scripts/lib/viewTransition.mjs) (`viewTransition(update, { force? })`) for anything that swaps a whole page/panel. It already respects `prefers-reduced-motion` and swallows the expected `AbortError` / `InvalidStateError` / `TimeoutError`. Do not call `document.startViewTransition` directly, and do not add a motion dependency.

## Perf constraints (checked)

- **Enumerate transition properties.** Never `transition: all`, Tailwind `transition-all`, `transition-property: all`, or the implicit-all form `transition: 0.2s ease` — a later property addition would ride along untyped.
- **Do not transition reflow properties** (`width` / `height` / `min|max-*` / `inset*` / `margin*` / `padding*` / `flex-basis` / `grid-template-*`). Animate `transform` / `opacity`, or use `grid-template-rows` for height reveals. Genuine exceptions (progress bars, card resize, height reveal) carry an above-line `/* motion-ignore: reason */`.
- **`will-change` only on compositor-friendly props** (`transform` / `opacity` / `filter` / `backdrop-filter` / `scroll-position` / `contents`). `will-change: width` promotes nothing and costs VRAM.
- **Keep the global `prefers-reduced-motion` guard in [`base.css`](../base.css).** It is the single reduced-motion net for the whole frontend — page-local animations rely on it instead of shipping their own copy.

## Pick by usage, never by the nearest number

Match the visible UI element, then the verb. If nothing matches, leave the value alone — do not force a swap.

| UI intent | Technique |
| --- | --- |
| Trigger + small dot floating on it (chat unread, social) | notification badge |
| Trigger + anchored surface that grows from it | dropdown / popover |
| Centered blocking surface | modal (`<dialog>`, `dialog.mjs`) |
| Two screens, list ↔ detail | page transition (`viewTransition.mjs`) |
| Element text changes in place | text swap |
| Two icons in the same slot | icon swap |
| A number updates | number pop-in |
| Confirmation / "done" moment | success check |
| In-progress / thinking text | shimmer / streaming text |
| Placeholder that swaps to real content | skeleton reveal |
| Hover/focus hint over a trigger | tooltip |
| Collapsible header + body (settings group, filter) | `grid-template-rows` expand (chevron flips via `scaleY(-1)`, not `d:` morph — Chromium-only) |
| Transient message | toast |

Prefer the lower-overhead option when two fit (dropdown over modal, resize over full panel).

## Timing

Opening is an invitation; closing gets out of the way.

- **Open/close asymmetry:** dropdown/modal open ~250ms → close ~150ms; panel open ~400ms → close ~350ms. Symmetric pairs that read as one reversible motion (tabs, accordion, icon swap, text swap, page slide) stay equal both ways.
- **Overshoot curves belong to entrances only** (badge pop, number pop-in). Never bounce a close.
- **Hover in** is quick and direct; **hover out** may be softer/longer so the row settles instead of snapping.
- **Stagger** ~40ms per item, total (offset × count) under ~300ms; shrink the offset or cap the count for long lists.
- **Delay** is only for filtering accidental triggers (tooltip intent) or sequencing. If motion feels late, trim the duration — and **never delay a close or hover-out**.

## Common mistakes

- Stripping the close-state cleanup timer (`.is-closing` removal) — the next open then jumps from the closing scale.
- Forgetting the reflow (`void el.offsetWidth` between class removal and re-add) that replays an animation.
- Animating the container instead of the inner piece (badge dot, not the trigger; page sections, not the wrapper).
- Binding `pointermove` on a rotating tilt card instead of the flat wrapper — the edges slip under the cursor and hover flickers.
- Re-declaring the reduced-motion guard per file instead of relying on `base.css`.
