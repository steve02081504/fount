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

Retiring a dead key takes two runs, because the script has no call-site to gate on: delete it from `zh-CN.json` first (`"if file_name == 'zh-CN.json': set(key, None)"`), then run the plain `set(key, None)` across every locale to clear the `extra_key` residue `checks:i18n_keys` now reports for each of them. Regenerate `src/decl/locale_data.ts` from the reference locale afterwards (`.esh/commands/update-locales.py`'s `generate_locale_data_ts`, or `data/locale_copy_review/regen_locale_data.py` standalone to avoid a Google sync); the flat key map at the bottom of that file is part of the generation, not a hand list.

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

## A failed sync leaves `null`, never silence

`update-locales.py` writes a same-shape `null` skeleton for every key it could not translate — including the case where Google is unreachable and the run circuit-breaks — and reports every gap at the end of the run (log summary per language, `::warning::` annotations, `GITHUB_STEP_SUMMARY`). `null` in a locale file is therefore a greppable retry marker, and `checks:i18n_copy` (rule `null`) turns it red.

Filling that block is a `locale_copy_sample.py apply` job, not 17 hand edits: write one `<locale>.patch.jsonl` (one `{"key", "new"}` object per line) per locale and apply it — `apply` validates that the key exists and that the `${placeholder}` set matches `zh-CN`, and preserves the file's key order. `update_locale_data.py` is only needed when the key set itself changes, because `apply` cannot add a key. `emoji` and `lzh` still need a hand rewrite ([Targets Google cannot translate](#targets-google-cannot-translate)).

Never "fix" a red run by leaving the key out or by keeping the previous copy: a missing key used to be invisible to every check, and this workflow pushes with `GITHUB_TOKEN`, so its commit does not re-trigger Run Tests. That combination is how 14 locales silently lost their `chat.group.settings.page.worlds`, `captcha`, `code.explorer` and `invitation-required` blocks (PR #246's circuit-break path returned without writing anything). Fill the copy, or leave the `null` for the next run to retry. `checks:i18n_keys` now owns that class: dropping the key instead of filling it fails as `missing_key` / `missing_node` (see below).

## A key a locale never had is not a translation gap

The bundle is **one locale file, not a merge**. `getLocaleData(localeList)` resolves the best match and returns that file alone ([bare.mjs](../../../scripts/i18n/bare.mjs)); `FALLBACK_LOCALE` (`en-UK`) only applies when the requested id matches *nothing*. So a key missing from (say) `emoji.json` is absent from the bundle for an emoji user: `geti18n` logs `[i18n:missing]`, reports to Sentry and returns the **key string itself**, and a `data-i18n` element is simply left empty. There is no "falls back to English" safety net at the leaf level, and the browser does not warn about it at build time — only a Playwright page that renders that leaf hits it.

The key-name return is the browser implementation ([index.mjs](../../pages/scripts/i18n/index.mjs)); the Node-side `bare.mjs` `geti18n` returns `console.warn`'s `undefined` instead, so a Node consumer that compares the value against the key before falling back to English (the code shell's CLI TUI does) never falls back — a `null` leaf paints the literal `null`, an absent one paints `undefined`.

`checks:i18n_keys` therefore compares each locale's key set against `zh-CN` and fails on both directions:

- `missing_key` / `missing_node` — the locale has no such leaf (or no such subtree). Fill it, or delete it from `zh-CN` too if it is dead.
- `extra_key` / `extra_node` — the locale has a leaf `zh-CN` does not. That is sync residue or a key deleted from the source and forgotten here; the next sync will either resurrect it or translate it back, so confirm it is dead and delete it.

The two rules that already existed could not see this: value-kind and placeholder comparisons only run on **shared** paths, so a key the locale does not have was silently skipped — exactly the shape a "I'll leave the key out" fix produces, and exactly why the `null` marker above could not be dropped in favour of omission. Switch leaves are terminals here (their `default` / `cases` are not key paths) and `string` ↔ `switch` stays compatible, so a locale that adds plural branches does not trip either direction.

## Targets Google cannot translate

A locale whose code has no Google target silently lands on its **base** language: `lzh` is not a Google code, so `get_compatible_code('lzh')` returns `zh` and every new key is written as **Simplified Chinese** — no `null`, no warning, checks green. `emoji` is the one target with an explicit branch (it copies the source); everything else unsupported copies a real language. Landed that way once already: the batch that added `code.explorer` / `captcha` / `invitation-required` shipped all 49 leaves byte-identical to zh-CN in `lzh`, and the same defect reached `emoji.json` (fixed in `83a1c67c`) and the world-settings block (fixed in `20bd269b`). When a sync touches a locale with no Google target, diff it against its base language and rewrite the new leaves by hand.

The nets, in the order they fire: `checks:i18n_keys` `forbidden_script` catches an emoji leaf that got Chinese / kana / Cyrillic copy, and `scanEmojiLocaleCopiedSource` also fails an emoji leaf that is byte-identical to a `zh-CN` leaf containing Han, which is the copy branch itself rather than its residue. `lzh` is the harder one — Han is legal there, so nothing can machine-detect "this is Simplified Chinese, not classical"; it stays a hand-check, and the two rules above bound the damage to writing-system mismatches. `checks:i18n_copy` cannot see either class.

## Counts belong in the source leaf, not glued on by the caller

`zh-CN` owns the placeholder set ([i18n_keys](../../../scripts/checks/AGENTS.md) `placeholder_mismatch`), so no locale can introduce `${count}` on its own to reach its own word order. A source leaf that is a bare counting unit while the caller renders `` `${count} ${geti18n(…)}` `` therefore leaves every inflecting language no shape that reads right on `1` — `code.explorer.lines` shipped as the unit alone and the editor status printed `1 строк`. Let the source leaf carry the count placeholder instead of gluing the number on at the call site, and pass that count from the call site (`geti18n('code.explorer.lines', { count })`); then a language that needs number forms writes a switch leaf beside the plain-string locales, which `i18n_keys` accepts as the same leaf kind:

```json
"lines": {
	"switch": "count",
	"default": "${count} строк",
	"cases": { "count % 10 === 1 && count % 100 !== 11": "${count} строка" }
}
```

`cases` keys are matched exactly first, then each key is evaluated as a JS expression in the params scope and must return strictly `true` ([switch_value.mjs](../../pages/scripts/i18n/switch_value.mjs)), so a plural rule is a condition rather than an enumeration. After a leaf gains a placeholder, regenerate `src/decl/locale_data.ts` with `.esh/commands/update-locales.py`'s `generate_locale_data_ts` (the declaration is a function of the reference locale) — the new `params` type is what keeps a call site from forgetting the count. `emoji.json` needs the `${count}` too: the placeholder check compares every locale against `zh-CN`.

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
