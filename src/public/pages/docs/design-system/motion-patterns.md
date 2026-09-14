# Motion patterns

fount has **no motion library**. Motion is page-local CSS plus a small set of
shared helpers. This file is the catalogue: it names the patterns the project
uses, maps each to the technique that implements it, and says which helper (if
any) to reach for.

Hard performance rules and timing rationale live in
[motion-notes.md](../motion-notes.md) and are enforced by the `motion_hygiene`
check. Read that first; this file assumes it.

## Helpers

| Helper | What it does |
| --- | --- |
| [`viewTransition.mjs`](../../scripts/motion/viewTransition.mjs) | the only sanctioned entry to the View Transitions API; reduced-motion aware |
| [`viewTransitionNames.mjs`](../../scripts/motion/viewTransitionNames.mjs) | set / clear `view-transition-name` pairs for shared-element transitions |
| [`stagger.mjs`](../../scripts/motion/stagger.mjs) | assign `--stagger-i` across a list so CSS can offset entrances |
| [`motion/index.mjs`](../../scripts/motion/index.mjs) | replay keyframes, pop a number, swap an icon, reduced-motion probe |

The helper CSS (timing tokens, keyframes, reduced-motion guard, view-transition
chrome) lives in [`motion/styles.css`](../../scripts/motion/styles.css), imported
globally by `base.css`; `base.mjs` pulls in the JS entry. Never call
`document.startViewTransition` directly. Never add a motion dependency.

## Pattern catalogue

| Pattern | When | Technique |
| --- | --- | --- |
| **Page transition** | list ↔ detail, tab views that replace a whole page | `viewTransition(update)`; direction via `html[data-transition-direction]` |
| **Shared element** | card → detail (avatar, title, hero media) | `viewTransitionNames.set(pair)` before the swap, `.clear()` after |
| **List stagger** | a list enters for the first time | `stagger.mjs` sets `--stagger-i`; CSS `animation-delay: calc(var(--stagger-i) * var(--duration-stagger))`, capped ~300ms |
| **Card hover lift** | feed / explore cards | `transform: translateY(-2px)` + `--shadow-md`, transition `transform, box-shadow` |
| **Icon swap** | outline ↔ filled (like, bookmark, mute) | `motion.swapIcon` — cross-fade + scale on the inner icon, never the trigger |
| **Number pop-in** | like / reply / follower counts change | `motion.popNumber` — scale `1 → 1.18 → 1` with `--ease-pop` on the digit span |
| **Notification badge** | unread count appears | small dot scales in from the trigger with `--ease-pop`; slide direction follows badge position |
| **Like burst** | a like lands | `motion.burst` spawns short-lived Iconify particles; `transform`/`opacity` only |
| **Skeleton reveal** | placeholder → real content | static skeleton with a `background-position` shimmer, cross-fade to content |
| **Tabs sliding pill** | nav / filter tab strip | one absolutely-positioned pill moved with `transform: translateX()` |
| **Dropdown / menu** | anchored surface grows from trigger | origin-aware `transform-origin`, open `--duration-open`, close `--duration-close` |
| **Modal** | centred blocking surface | `<dialog>` + `dialog.mjs`; scale/opacity entrance only |
| **Toast** | transient message | `features/toast.mjs` `animate-fade-in-up` / `animate-fade-in-down` |
| **Text swap** | a label changes in place | cross-fade two stacked spans; blur optionally |
| **Success check** | "done" moment | Iconify check scales/draws in; do not bounce a close |
| **Error shake** | rejected input | short `cubic-bezier` translateX shake; never loops |
| **Accordion / reveal** | settings group, fold-out body | `grid-template-rows: 0fr → 1fr` (add `motion-ignore`); chevron flips via `scaleY(-1)` |
| **Shimmer text** | in-progress / streaming | masked gradient sweep via `background-position`; no layout change |

Prefer the lower-overhead pattern when two fit (dropdown over modal, resize over
full panel).

## Stagger in practice

```js
import { applyStagger } from '/scripts/motion/stagger.mjs'

applyStagger(feedList.children)   // sets --stagger-i = 0,1,2…
```

```css
.feed-item {
	opacity: 0;
	animation: fade-in-up var(--duration-open) var(--ease-entrance) forwards;
	animation-delay: calc(var(--stagger-i, 0) * var(--duration-stagger));
}
```

Cap the list: stop assigning after ~7 items, or the draw-in takes too long.

## Micro-interactions in practice

```js
import { popNumber, swapIcon, burst, prefersReducedMotion } from '/scripts/motion/index.mjs'

popNumber(countEl)
swapIcon(iconEl, { to: 'filled' })
burst(hostEl, { icon: 'icon-like' })
```

Each helper checks `prefers-reduced-motion` and becomes a no-op or an instant
state change when reduced motion is requested. The global guard in `motion/styles.css`
covers CSS-driven motion; these helpers cover JS-driven motion.

## Particles without emoji

Bursts and floating reactions use Iconify glyphs, never emoji. Social's icon
system (`.icon` + `--icon` mask) and the shared `text-icon` `<img>` both inherit
`currentColor`, so particles theme correctly. See
[iconography.md](iconography.md).

## Adding a pattern

1. Match the visible element and the verb using the table above.
2. If nothing matches, do not invent a bespoke curve — leave the value alone.
3. Animate `transform` / `opacity`; a layout animation needs an above-line
   `/* motion-ignore: reason */`.
4. Respect reduced motion (CSS globally, JS via the helpers).
5. Add the row to this catalogue so the next person finds it.
