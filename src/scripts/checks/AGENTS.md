---
description: Repo static health checks — suites, rules, and operator tools
globs: src/scripts/checks/**
alwaysApply: false
---

# Static Checks Guide

Manifest: `src/scripts/checks/test/manifest.json` (`checks`). Run: `fount test checks` / `checks:<suite>`.

Full per-suite rules (exemptions, ignore markers, auto-fix): [docs/suites.md](docs/suites.md). Each failure message names the rule; read the suite row there before suppressing anything.

| Suite | Enforces (summary) |
| --- | --- |
| `html_meta` | HTML meta / landmarks / drawer & aside ARIA; readme/EULA redirect locales |
| `meta_language` | `og:*` / `description` meta English-only; `<title>` empty or Chinese-free; empty-title pages' en-UK `<pageid>.description` equals the meta |
| `info` | part `locales.json` / achievements info + icon URLs; no `null` leaf |
| `home_registry` | `home_registry.json` info keys resolve in zh-CN / en-UK / ja-JP; display entries carry a `title` |
| `i18n_keys` | locale key structure, value kinds, placeholders and key-set coverage vs zh-CN; `emoji.json` script rules |
| `i18n_copy` | machine-translation residue in locale copy (mangled product name, lost tokens/identifiers, wrong scripts, stray spacing, English leftovers). Scanner: `i18n_copy.mjs` |
| `i18n_refs` | `data-i18n` / string-API keys resolve with an applicator and cover their `${placeholder}`s |
| `reshape_i18n_keys` / `update_locales` / `update_locale_data` / `locale_copy_sample` / `locale_copy_worklists` | `--self-test` of the `.esh/commands/*.py` locale tools |
| `agents_md_english` | `AGENTS.md` + linked `.md` English-only; linked non-`AGENTS.md` files live under `docs/` |
| `text_lf` | UTF-8, LF, exactly one trailing LF, no leading LF. **Auto-fixes** first |
| `jsdoc_no_english` | Chinese JSDoc summaries; multi-line block marker / layout rules |
| `locale_md_align` | `docs/EULA` / `docs/readme` locale families line-aligned vs en-UK; locale id sets agree |
| `theme_radius` / `theme_color` / `daisyui_var` | themed frontend uses theme radius / border / color vars (no fixed `rounded-*`, `btn-circle`, hardcoded fallbacks, v4 abbreviations) |
| `icon_crossorigin` | icon `<img>` from CORS icon hosts carry `crossorigin="anonymous"` (**auto-fix**); data-driven URLs use `corsImage.mjs` |
| `no_manual_svg` | no hand-written inline `<svg>` — Iconify + `svgInliner` |
| `motion_hygiene` | no `transition: all` / reflow-property transitions; `will-change` only on compositor props |
| `ms_literal` | Deno-side code uses `ms('…')` instead of hand-computed millisecond products |
| `build_string` | multi-line static text as template literals, not `[...].join('\n')` / `+` chains |
| `no_ts_import` | `.mjs` / `.js` never runtime-import repo `.ts` (`.ts` is JSDoc types only) |

`listRepoFiles` (`walk.mjs`): default is `git ls-files` (+ untracked, exclude-standard); pass `ignore` to force a filesystem walk. Empty/omitted suffixes = all files.

## i18n keys

- No `Suffix` / `Prefix` affix keys.
- No ≥4 flat camelCase siblings sharing a prefix.
- No `xxx1`-style numbered keys.
- Every non-`zh-CN` locale must match `zh-CN` **value kinds** on shared paths after sync (`string` vs `{ "aria-label": … }` etc. fails). `update-locales.py` may normalize string↔single DOM applicator and **exits 1** on remaining mismatches; leaf `string` ↔ switch stays compatible. Details: [locale-edits.md](../../public/locales/docs/locale-edits.md).
- Every non-`zh-CN` locale must **cover `zh-CN`'s key set** — a missing leaf or subtree fails (`missing_key` / `missing_node`), and so does a leaf the reference does not have (`extra_key` / `extra_node`). There is no per-key fallback: `getLocaleData` picks one locale file (fallback `en-UK` only when the requested id matches nothing), so a missing key renders as its own key name via `geti18n` and leaves `data-i18n` elements empty. See [locale-edits.md](../../public/locales/docs/locale-edits.md#a-key-a-locale-never-had-is-not-a-translation-gap). Scanner: `scanLocaleKeyCoverage` in `src/scripts/checks/i18n_keys.mjs`.
- `emoji.json` strings must not contain Han / kana / Cyrillic (latin is fine for commands, shortcuts, interpolations). `update-locales.py` copies zh-CN into Google-unsupported langs — this check is the net.
- `emoji.json` must not repeat a `zh-CN` leaf containing Han verbatim (`scanEmojiLocaleCopiedSource`): that is `update-locales.py`'s copy branch, i.e. a leaf no translator ever touched (`emoji` has no Google target, so the sync writes the source). It is a different failure from the forbidden-script rule above: the Han there comes from the shared source leaf, while this one proves the emoji leaf was simply not rewritten.
- Prefix-nest **writeback** only via `.esh/commands/reshape_i18n_keys.py` (JS `JSON.stringify` reorders numeric keys like `404`). Day-to-day locale edits: root [AGENTS.md](../../../AGENTS.md) I18n.

## i18n refs (`i18n_refs`)

- Element binding (`data-i18n`, `setElementI18n`): key must exist; objects need ≥1 applicator (`placeholder`, `title`, `label`, `value`, `alt`, `aria-label`, `textContent`, `innerHTML`, `dataset`). Prefer `.main` for “string plus sibling messages” — object key without applicator leaves the control empty (Playwright `[i18n:missing]` does not catch this).
- String binding (`showToastI18n`, `confirmI18n`, …) and path CLI / runner `Get-I18n` / `get_i18n` / `print_i18n_*`: must resolve to a string (or tip array). Raw `geti18n` may return objects; only missing keys fail. `handleError('key')` scanned only from frontend `features/errorHandlers.mjs` (not backend `scripts/errorHandlers.mjs`).
- Static keys only (`a.b.c`); skip template interpolations. Rewrite suffixes include `.sh`.

## Agent docs language

Enforced by `agents_md_english`; writing rules: [docs/AGENTS.md](../../../docs/AGENTS.md).

## JSDoc language (`jsdoc_no_english`)

- Summaries must be Chinese (contain CJK). Pure-English summaries fail.
- A multi-line JSDoc must open with `/**` alone on its first line and close with `*/` alone (indented) on its last line — content on either marker line (`/** summary\n * …`, `… summary */`) fails. Single-line blocks are exempt.
- A multi-line JSDoc must own its source line and sit inside an **already expanded** literal: `createCallbackSessionClient({ /**` (badge style) and `createCallbackSessionClient({ fetchMetadata: x, /**` both fail; the statement opens the literal on its own line (`const client = create({`), every member gets its own line, and `*/` never shares a line with a member. Inline single-line `/** @type … */` casts and one-line summaries before a statement stay legal.
- Tag-only blocks (`@param` / `@typedef` / … without a prose summary) are fine; empty `/** */` stubs are not a substitute for a real one-liner on re-exports.
- `extractJsdocBlocks` matches inline `/**` (e.g. `{ /** … */ prop`) as well as line-leading blocks; skips JSDoc-shaped text inside strings, templates, and ordinary line/block comments; reports each block's `linePrefix`.
- List leftovers: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_jsdoc_no_english.mjs` (optional path arg).
- Locale markdown families: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_locale_md_align.mjs` (optional dir; default `docs/EULA` + `docs/readme`). Locale **id** sets: `fount test checks:locale_md_align` (`locale_sets.mjs`).

## HTML og meta tone

- Full-page `og:title` / `og:description` should carry imagery and rhetoric (see polished pages such as chat / login / wait).
- `og:title` / `og:description` / `name="description"` must be English: no Han, kana, or Cyrillic (`checks:meta_language`). A page that fails is asked for poetic English in the assertion message — that is the wording to reuse, not a transliteration.
- `<title>` is either empty or Chinese-free. An empty one means the page translates its title at runtime (`initTranslations` → `document.title`), so the locale's `<pageid>.title` supplies it; a non-empty one is static text (`fount!`, `preloadrunner`, a wordmark) and only has to avoid Han / kana / Cyrillic.
- A page whose `<title>` is empty must have `<pageid>.description` in `en-UK.json` **byte-identical** to its `name="description"` and `og:description` (`checks:meta_language`) — `applyTranslations` overwrites the static description meta with the locale value at runtime, so a drift means crawlers and the running page show different copy. Other locales carry a native translation of that description, never the English through.
- Pages that differ must not share copy: a second page under the same root gets a nested id (`blog.article_detail`, `protocolhandler.github`, `oauth_handler.callback`, `oauth_handler.pages_bounce`), never the parent's id.
- List all og meta: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_og_meta_poetic.mjs` (optional subpath). Extraction: `og_meta_list.mjs`.
