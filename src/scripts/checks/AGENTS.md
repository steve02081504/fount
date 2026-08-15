---
description: Repo static health checks — suites, rules, and operator tools
globs: src/scripts/checks/**
alwaysApply: false
---

# Static Checks Guide

Manifest: `src/scripts/checks/test/manifest.json` (`checks`). Run: `fount test checks` / `checks:<suite>`.

| Suite | Enforces |
| --- | --- |
| `html_meta` | HTML meta / landmarks / `drawer-toggle` / aside ARIA; `og_meta_list` `under` prefix filter; pages readme redirect locales vs `docs/readme/` |
| `info` | parts `locales.json` / `achievements_registry.json` info + remote icon URL |
| `i18n_keys` | locale key structure + shared-path value kinds vs zh-CN + emoji.json must not carry Han/kana/Cyrillic |
| `i18n_refs` | `data-i18n` / `setElementI18n` objects need a DOM applicator; string APIs + `path/fount.{ps1,sh}` keys must resolve to strings |
| `reshape_i18n_keys` | `.esh/commands/reshape_i18n_keys.py --self-test` |
| `update_locales` | `.esh/commands/update-locales.py --self-test` (string↔single-applicator + string↔switch) |
| `agents_md_english` | `AGENTS.md` + linked `.md` English-only; non-`AGENTS.md` under `docs/` |
| `text_lf` | UTF-8 text (fatal decode, no NUL) must be LF; under `fount test` scopes to triggered files when set |
| `jsdoc_no_english` | JSDoc summaries: Chinese (CJK required; pure English flagged) |
| `locale_md_align` | Parallel `Stem.locale.md` families (`docs/EULA`, `docs/readme`): same line count; per-line heading / hr / quote / fence / list marker / bold / italic / link / image / inline-code counts vs `en-UK` |

`listRepoFiles` (`walk.mjs`): default is `git ls-files` (+ untracked, exclude-standard); pass `ignore` to force a filesystem walk. Empty/omitted suffixes = all files.

## i18n keys

- No `Suffix` / `Prefix` affix keys.
- No ≥4 flat camelCase siblings sharing a prefix.
- No `xxx1`-style numbered keys.
- Every non-`zh-CN` locale must match `zh-CN` **value kinds** on shared paths after sync (`string` vs `{ "aria-label": … }` etc. fails). `update-locales.py` may normalize string↔single DOM applicator and **exits 1** on remaining mismatches; leaf `string` ↔ switch stays compatible. Details: [locale-edits.md](../../public/locales/docs/locale-edits.md).
- `emoji.json` strings must not contain Han / kana / Cyrillic (latin is fine for commands, shortcuts, interpolations). `update-locales.py` copies zh-CN into Google-unsupported langs — this check is the net.
- Prefix-nest **writeback** only via `.esh/commands/reshape_i18n_keys.py` (JS `JSON.stringify` reorders numeric keys like `404`). Day-to-day locale edits: root [AGENTS.md](../../../AGENTS.md) I18n.

## i18n refs (`i18n_refs`)

- Element binding (`data-i18n`, `setElementI18n`): key must exist; objects need ≥1 applicator (`placeholder`, `title`, `label`, `value`, `alt`, `aria-label`, `textContent`, `innerHTML`, `dataset`). Prefer `.main` for “string plus sibling messages” — object key without applicator leaves the control empty (Playwright `[i18n:missing]` does not catch this).
- String binding (`showToastI18n`, `confirmI18n`, …) and `path/fount.{ps1,sh}` `Get-I18n` / `get_i18n`: must resolve to a string (or tip array). Raw `geti18n` may return objects; only missing keys fail. `handleError('key')` scanned only from frontend `features/errorHandlers.mjs` (not backend `scripts/errorHandlers.mjs`).
- Static keys only (`a.b.c`); skip template interpolations. Rewrite suffixes include `.sh`.

## Agent docs language

Enforced by `agents_md_english`; writing rules: [docs/AGENTS.md](../../../docs/AGENTS.md).

## JSDoc language (`jsdoc_no_english`)

- Summaries must be Chinese (contain CJK). Pure-English summaries fail.
- Tag-only blocks (`@param` / `@typedef` / … without a prose summary) are fine; empty `/** */` stubs are not a substitute for a real one-liner on re-exports.
- List leftovers: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_jsdoc_no_english.mjs` (optional path arg).
- Locale markdown families: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_locale_md_align.mjs` (optional dir; default `docs/EULA` + `docs/readme`).

## HTML og meta tone

- Full-page `og:title` / `og:description` should carry imagery and rhetoric (see polished pages such as chat / login / wait).
- List all og meta: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_og_meta_poetic.mjs` (optional subpath). Extraction: `og_meta_list.mjs`.
