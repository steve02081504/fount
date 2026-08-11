# Locale bulk edits

Day-to-day i18n rules: [root AGENTS.md](../../../../AGENTS.md).

## Key structure (enforced by `fount test checks:i18n_keys`)

Scan sibling keys under each object in `zh-CN.json` (structure is the contract for all locales):

1. **No Suffix/Prefix affix keys** — a segment must not start or end with `Suffix` / `Prefix`. Prefer a full sentence template with `${param}`; do not hard-concatenate affix fragments.
2. **Nest flat camelCase clusters** — if ≥4 siblings share the same camelCase prefix (`channelPermsHint`…), nest as `channelPerms: { hint, … }`. Single-segment prefixes count too (`tabMembers`… → `tabs: { members, … }`). Nest longest prefixes first. **SCREAMING_SNAKE constant keys** (`SEND_MESSAGES` / `VIEW_CHANNEL`) are excluded from cluster scans; nested suffixes that are themselves SCREAMING_SNAKE stay as-is (`permSEND_MESSAGES` → `perm.SEND_MESSAGES`, never `sEND_MESSAGES`).
3. **No numbered key tails** — keys matching `name1` / `item2` (`/^[A-Za-z][A-Za-z]*\d+$/`) fail; use meaningful names or arrays. Pure numeric keys like `404` are fine.
4. **Shared-path value kinds** — every other locale JSON must match `zh-CN` types on keys both trees share (`string` vs `{ "aria-label": … }` etc. fails — UI would bind wrong). **Exception:** a leaf may be a plain `string` in one locale and a **switch** object (`{ "switch", "default", "cases?" }`) in another — see [i18n-notes.md](../../pages/docs/i18n-notes.md). `update-locales.py` wraps string↔single DOM applicator (`aria-label` / `title` / …) during sync and **exits 1** on remaining type mismatches; string↔switch is left as-is (no structural sync of `cases`).

Always move keys with `.esh/commands/update_locale_data.py` (below) — never hand-edit every locale JSON. The script exposes `file_name` (e.g. `'it-IT.json'`) so a branch can touch one locale; unchanged files are skipped on write.

## Moving keys

Use `.esh/commands/update_locale_data.py` — **move with `get(old)` → `set(new, value)` → `set(old, None)`** so each locale keeps its existing copy.

Never delete then refill from zh-CN: `fake` / `emoji` and other non-Google targets collapse to Chinese.

When updating call sites, rewrite only quoted i18n key strings — do not blind-replace `profile.xxx` object fields or module paths.

**Locale JSON writeback**: Python tools (`update_locale_data.py` / `update-locales.py` / `reshape_i18n_keys.py`) own structural key changes and preserve JSON key order. After generation, hand-fixing a single non-zh-CN locale's translation is fine. Avoid JS `JSON.stringify` for locale files — it reorders pure numeric keys like `"404"` to the front of the object.

## Prefix nest reshape

When ≥4 camelCase siblings share a prefix:

```text
python .esh/commands/reshape_i18n_keys.py
python .esh/commands/reshape_i18n_keys.py path/to/extra_renames.json
```

Nests all locales, writes `data/test/i18n_key_rename_map.json`, and rewrites quoted old keys in-repo. A second exact pass may still use `src/scripts/checks/tools/rewrite_i18n_exact_pass.mjs` (source only — does not write locale JSON).

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
