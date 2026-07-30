# Locale bulk edits

Day-to-day i18n rules: [root AGENTS.md](../../../AGENTS.md).

## Key structure (enforced by `fount test checks:i18n_keys`)

Scan sibling keys under each object in `zh-CN.json` (structure is the contract for all locales):

1. **No Suffix/Prefix affix keys** — a segment must not start or end with `Suffix` / `Prefix`. Prefer a full sentence template with `${param}`; do not hard-concatenate affix fragments.
2. **Nest flat camelCase clusters** — if ≥4 siblings share the same camelCase prefix (`channelPermsHint`…), nest as `channelPerms: { hint, … }`. Single-segment prefixes count too (`tabMembers`… → `tabs: { members, … }`). Nest longest prefixes first.
3. **No numbered key tails** — keys matching `name1` / `item2` (`/^[A-Za-z][A-Za-z]*\d+$/`) fail; use meaningful names or arrays. Pure numeric keys like `404` are fine.

Always move keys with `.esh/commands/update_locale_data.py` (below) — never hand-edit every locale JSON.

Bulk nest / call-site rewrite helpers (after large structural changes): `src/scripts/checks/tools/reshape_i18n_keys.mjs` and `rewrite_i18n_exact_pass.mjs`.

`reshape_i18n_keys.mjs` only nests prefix clusters by default. Pass a throwaway JSON map for one-shot semantic renames (same idea as `update_locale_data.py` `@script.py`):

```text
deno run --allow-scripts --allow-all -c deno.json src/scripts/checks/tools/reshape_i18n_keys.mjs tmp_renames.json
```

`tmp_renames.json` shape: `{ "old.key.path": "new.key.path", ... }`. Do not bake that table into the tool. Output of a run lands in `data/test/i18n_key_rename_map.json` for `rewrite_i18n_exact_pass.mjs`.

## Moving keys

Use `.esh/commands/update_locale_data.py` — **move with `get(old)` → `set(new, value)` → `set(old, None)`** so each locale keeps its existing copy.

Never delete then refill from zh-CN: `fake` / `emoji` and other non-Google targets collapse to Chinese.

When updating call sites, rewrite only quoted i18n key strings — do not blind-replace `profile.xxx` object fields or module paths.

## Reshape string → `{ title, aria-label }`

Icon / tooltip-only controls: keep each locale's existing string, wrap in place — do **not** retranslate via `update-locales.py`.

```text
update_locale_data "for key in ('chat.emoji.jumpToStart', 'chat.emoji.jumpToUnicode', 'chat.emoji.recent'):
  value = get(key)
  if isinstance(value, str) and value:
    set(key, {'title': value, 'aria-label': value})
  elif isinstance(value, dict):
    label = value.get('title') or value.get('aria-label') or value.get('textContent')
    if label:
      set(key, {'title': label, 'aria-label': label})
"
```

Same pattern for unicode group labels (`chat.unicodeEmojiGroups.*`). Rail uses the object key (`title` / `aria-label`); section header uses `` `${key}.title` `` as a string leaf so visible text fills without wiping rail glyphs.

Frontend: `data-i18n` on the key; put the icon in `innerHTML` / children — object locales only set `title` / `aria-label`, they do not wipe markup. Do **not** add `textContent`/`innerHTML` to icon-button locales.
