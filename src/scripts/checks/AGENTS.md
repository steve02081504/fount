---
description: Repo static health checks — suites, rules, and operator tools
globs: src/scripts/checks/**
alwaysApply: false
---

# Static Checks Guide

Manifest: `src/scripts/checks/test/manifest.json` (`checks`). Run: `fount test checks` / `checks:<suite>`.

| Suite | Enforces |
| --- | --- |
| `html_meta` | HTML meta / landmarks / `drawer-toggle` / aside ARIA |
| `info` | parts `locales.json` / `achievements_registry.json` info + remote icon URL |
| `i18n_keys` | locale key structure (below) |
| `i18n_refs` | `data-i18n` / `setElementI18n` objects need a DOM applicator; string APIs + `path/fount.{ps1,sh}` keys must resolve to strings |
| `reshape_i18n_keys` | `.esh/commands/reshape_i18n_keys.py --self-test` |
| `agents_md_english` | `AGENTS.md` + agent-facing linked `.md` English-only |
| `jsdoc_no_english` | JSDoc summaries: Chinese (CJK required; pure English flagged) |

## i18n keys

- No `Suffix` / `Prefix` affix keys.
- No ≥4 flat camelCase siblings sharing a prefix.
- No `xxx1`-style numbered keys.
- Prefix-nest **writeback** only via `.esh/commands/reshape_i18n_keys.py` (JS `JSON.stringify` reorders numeric keys like `404`). Root [AGENTS.md](../../../AGENTS.md) I18n covers day-to-day locale edits.

## i18n refs (`i18n_refs`)

Playwright and `[i18n:missing]` miss these cases:

- The key **exists** as an object, so the missing-key warning never fires.
- `translateSingularElement` only writes known applicator fields (`textContent`, `title`, …). Binding `data-i18n="….leave"` to a `{ main, confirm, … }` cluster leaves the control empty.
- CLI scripts use keys relative to `fountConsole.path` (e.g. `remove.removingFount`). Reshape rewrites full paths and historically skipped `.sh`, so stale relative keys never failed the old checks.

Rules:

- Element binding (`data-i18n`, `setElementI18n`): the key must exist; objects need ≥1 applicator (`placeholder`, `title`, `label`, `value`, `alt`, `aria-label`, `textContent`, `innerHTML`, `dataset`). Prefer `.main` for “string plus sibling messages” clusters.
- String binding (`showToastI18n`, `confirmI18n`, `handleError`, …) and `path/fount.{ps1,sh}` `Get-I18n` / `get_i18n`: must resolve to a string (or tip array). Raw `geti18n` may return objects (e.g. `util.zxcvbn`); only missing keys fail. `handleError('key')` is factory form — first arg is the i18n key.
- Static keys only (`a.b.c`); skip template interpolations. Rewrite suffixes include `.sh` (shared `walk.mjs` / `reshape_i18n_keys.py`).

## Agent docs language

- `AGENTS.md` and agent-facing linked `.md`: English only (no CJK).
- Exempt: human-facing `docs/design/`, `docs/review/`, `docs/issues/` (still walked for link resolution).
- Transitive local `.md` links must resolve.

## JSDoc language (`jsdoc_no_english`)

- Summaries must be Chinese (contain CJK). Pure-English summaries (Latin letters, no CJK) fail.
- Tag-only blocks (`@param` / `@typedef` / … without a prose summary) are fine; empty `/** */` stubs are not a substitute for a real one-liner on re-exports.
- List leftovers: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_jsdoc_no_english.mjs` (optional path arg to narrow).
