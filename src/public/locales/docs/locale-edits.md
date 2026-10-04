# Locale bulk edits

Day-to-day i18n rules: [root AGENTS.md](../../../../AGENTS.md).

## Key structure (enforced by `fount test checks:i18n_keys`)

Scan sibling keys under each object in `zh-CN.json` (structure is the contract for all locales):

1. **No Suffix/Prefix affix keys** — a segment must not start or end with `Suffix` / `Prefix`. Prefer a full sentence template with `${param}`; do not hard-concatenate affix fragments.
2. **Nest flat camelCase clusters** — if ≥4 siblings share the same camelCase prefix (`channelPermsHint`…), nest as `channelPerms: { hint, … }`. Single-segment prefixes count too (`tabMembers`… → `tabs: { members, … }`). Nest longest prefixes first. **SCREAMING_SNAKE constant keys** (`SEND_MESSAGES` / `VIEW_CHANNEL`) are excluded from cluster scans; nested suffixes that are themselves SCREAMING_SNAKE stay as-is (`permSEND_MESSAGES` → `perm.SEND_MESSAGES`, never `sEND_MESSAGES`).
3. **No numbered key tails** — keys matching `name1` / `item2` (`/^[A-Za-z][A-Za-z]*\d+$/`) fail; use meaningful names or arrays. Pure numeric keys like `404` are fine.
4. **Shared-path value kinds** — two phases:
   - **During sync:** `update-locales.py` may normalize a leaf between a plain `string` and a single DOM applicator object (`aria-label` / `title` / …).
   - **Post-sync contract:** every other locale JSON must match `zh-CN` types on keys both trees share (`string` vs `{ "aria-label": … }` etc. fails — UI would bind wrong). Remaining mismatches **exit 1**.
   - **string↔switch:** a leaf may be a plain `string` in one locale and a **switch** object (`{ "switch", "default", "cases?" }`) in another — see [i18n-notes.md](../../pages/docs/i18n-notes.md). That pairing is left as-is; do not restructure `cases` during sync.

Always move keys with `.esh/commands/update_locale_data.py` (below) — never hand-edit every locale JSON. The script exposes `file_name` (e.g. `'it-IT.json'`) so a branch can touch one locale; unchanged files are skipped on write.

## Moving keys

Use `.esh/commands/update_locale_data.py` — **move with `get(old)` → `set(new, value)` → `set(old, None)`** so each locale keeps its existing copy.

Never delete then refill from zh-CN: `fake` / `emoji` and other non-Google targets collapse to Chinese. `checks:i18n_keys` fails `emoji.json` if any string still carries Han / kana / Cyrillic — rewrite those leaves in emoji, do not wait for Google.

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
update_locale_data "for key in (...):
  value = get(key)
  if isinstance(value, str) and value:
    set(key, {'title': value, 'aria-label': value})
  elif isinstance(value, dict):
    label = value.get('title') or value.get('aria-label') or value.get('textContent')
    if label:
      set(key, {'title': label, 'aria-label': label})
"
```

Rail uses the object key (`title` / `aria-label`); section header uses `` `${key}.title` `` as a string leaf so visible text fills without wiping rail glyphs.

Frontend: `data-i18n` on the key; put the icon in `innerHTML` / children — object locales only set `title` / `aria-label`, they do not wipe markup. Do **not** add `textContent`/`innerHTML` to icon-button locales.

## Part `locales.json` info blocks

A part's own `locales.json` carries `info.<locale>` blocks (`name` / `avatar` / `description` / `description_markdown` / `version` / `author` / `home_page` / `tags`); `update-locales.py` translates them like any other locale file. Two rules a reviewer has to hold:

- **Never commit a `null` leaf.** A failed translation is written as `null` for the next run, and `null` renders as an empty plugin name for that user — `fount test checks:info` fails a part `locales.json` that still has one.
- **The bolded name is the locale's own name.** Give the plugin a name in the locale's language and repeat that exact string inside `**…**` in `description_markdown`; a translated `name` sitting next to an English bolded name (or the reverse) is sync residue, not a deliberate brand choice.

## Native-quality review loop

Machine-checkable residue is enforced by `fount test checks:i18n_copy` — null / empty leaves, product name written `font`, a space inside a compound, a lost newline or edge-whitespace frame, punctuation jammed against the wrong side, zero-width junk, doubled spaces, and letters from a writing system the locale does not use. Fix the copy, never the check, and add a rule there when a new class shows up.

What a check cannot see is copy that is grammatical but still reads translated. That part runs as bounded sample rounds, one language at a time:

```text
python .esh/commands/locale_copy_sample.py sample de-DE --seed round-1 [--count 120]
#   -> data/locale_copy_review/de-DE/round-1.tsv   (key, value, zh-CN, en-UK; prose-heavy leaves)
#   a native reviewer reads the TSV and answers with {"key","new","why"} JSONL
python .esh/commands/locale_copy_sample.py apply de-DE <patch.jsonl>
```

`apply` skips unchanged values and rejects an unknown key or a `${placeholder}` set that differs from zh-CN, and preserves the file's key order. `sample` records what it handed out in `data/locale_copy_review/<locale>/sampled.json` and skips those keys next time, so rounds cover fresh copy; `status` prints per-locale coverage, and once a locale is sampled through, sample it again with `--resample`. Loop per language: **finish the deterministic sweeps first, then sample immediately before dispatching the round** (a TSV sampled earlier goes stale and wastes the reviewer's attention), fix, apply, and move to the next language after **three consecutive rounds that find nothing**. Reviewer prompt: [locale_copy_review_prompt.md](locale_copy_review_prompt.md); regenerate the per-locale `brand.md` / `markup.md` / `drift.md` worklists with `.esh/commands/locale_copy_worklists.py [locale …]` (`brand.md` catches a product name translated into a local word — `fontur`, `fontein`, `Quelle`, `фонд` — which the check's `font`-rooted brand rule cannot see; `drift.md` lists the keys whose zh-CN sentence is identical but whose wording diverges inside one locale). The scan rules are in [fount test checks:i18n_copy](../../../scripts/checks/AGENTS.md); the sampler's own contract is covered by `fount test checks:locale_copy_sample`.
