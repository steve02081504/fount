# data-i18n notes

Day-to-day API: [AGENTS.md](AGENTS.md) (`i18n.mjs` / `setLanguage` / `primaryLocale`).

## Interpolation

`element.dataset` is the interpolation map. MutationObserver watches **only** `data-i18n`.

Nested attr keys: `placeholder` / `title` / `label` / `value` / `alt` / `aria-label` / `textContent` / `innerHTML` / `dataset`.

## Placeholders

**`input`/`textarea` placeholders must use an object key** (`{ "placeholder": "…" }`); a string key writes `innerHTML` and wipes the input.

Do **not** name keys `fooPlaceholder` / `fooAlt` — use `foo: { placeholder|alt: "…" }`. No `data-i18n-attr`.

## Persistent chrome

Use `data-i18n` / `setElementI18n` (swap the key to retarget) — not one-shot `geti18n()` → `textContent`. Shared `promptText` / `promptTextArea` / `confirmAction` take **i18n keys** (reactive). Keep `geti18n` for thrown errors / toast params / one-off non-dialog strings.

Icon-only controls: locale `{ title, aria-label }` ([locale-edits.md](../locales/locale-edits.md)); string keys on icon parents wipe children.

Setting `data-i18n` (or inserting markup that has it) is enough — body MutationObserver runs `i18nElement`; do not call it again. Use `setElementI18n` only when the key is unchanged but interpolation params change.
