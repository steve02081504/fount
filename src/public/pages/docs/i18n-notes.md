# data-i18n notes

Day-to-day API: [AGENTS.md](../AGENTS.md) (`i18n.mjs` / `setLanguage` / `primaryLocale`).

## Interpolation

`element.dataset` is the interpolation map. MutationObserver watches **only** `data-i18n`.

Nested attr keys: `placeholder` / `title` / `label` / `value` / `alt` / `aria-label` / `textContent` / `innerHTML` / `dataset`.

## Switch leaves (singular / plural)

A leaf may be a plain string **or** a switch object resolved by `geti18n` / `data-i18n` before interpolation:

```json
"aria-label": {
	"switch": "count",
	"default": "${count} items",
	"cases": { "1": "1 item" }
}
```

`cases` keys are matched against `String(params[switch])` (so `data-count="1"` hits `"1"`). Miss → `default`. Nested switches are resolved recursively. Cross-locale: string ↔ switch is allowed (only some languages need cases).

## Placeholders

**`input`/`textarea` placeholders must use an object key** (`{ "placeholder": "…" }`); a string key writes `innerHTML` and wipes the input.

Do **not** name keys `fooPlaceholder` / `fooAlt` — use `foo: { placeholder|alt: "…" }`. No `data-i18n-attr`.

## Persistent chrome

Use `data-i18n` / `setElementI18n` (swap the key to retarget) — not one-shot `geti18n()` → `textContent`. Shared `promptText` / `promptTextArea` / `confirmAction` take **i18n keys** (reactive). Keep `geti18n` for thrown errors / toast params / one-off non-dialog strings.

Icon-only controls: locale `{ title, aria-label }` ([locale-edits.md](../../locales/docs/locale-edits.md)); string keys on icon parents wipe children. Never hardcode English `aria-label` as a fallback — page watch requires Han on zh pages and Japanese script on ja pages; use `data-i18n` objects with `aria-label`.

**Icon / empty `<label>` controls** (DaisyUI drawer toggle/overlay, file-upload chrome): axe forbids `aria-label` on bare `<label>`, and `role="button"` on `<label>` fails `aria-allowed-role`. Do **not** put `{ aria-label }` objects on the `<label>`. Use a **string** key on a child `<span class="sr-only" data-i18n="…">`; keep `{ title, aria-label }` for real `<button>`s. Drawer overlay + panel must sit inside one landmark (`aside.drawer-side`) so sr-only text does not trip `region`.

Setting `data-i18n` (or inserting markup that has it) is enough — body MutationObserver runs `i18nElement`; do not call it again. Use `setElementI18n` only when the key is unchanged but interpolation params change.

## Pageid title / description

`initTranslations('foo')` always sets `document.title` from `foo.title`. If the document has `meta[name="description"]` (`checks:html_meta` requires it on full pages), it also `geti18n`s `foo.description` — a missing leaf is a Playwright `[i18n:missing]` hard-fail. Ship both keys with the page. Page watch cycles zh-CN → ja-JP → en-UK, so those three files need the string before PR locale sync.
