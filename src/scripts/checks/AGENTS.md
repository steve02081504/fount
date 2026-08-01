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
| `jsdoc_english` | JSDoc summaries: Latin letters, no CJK |

## i18n keys

- No `Suffix` / `Prefix` affix keys.
- No ≥4 flat camelCase siblings sharing a prefix.
- No `xxx1`-style numbered keys.
- Prefix-nest **writeback** only via `.esh/commands/reshape_i18n_keys.py` (JS `JSON.stringify` reorders numeric keys like `404`). Root [AGENTS.md](../../../AGENTS.md) I18n covers day-to-day locale edits.

## i18n refs (`i18n_refs`)

Why Playwright / `[i18n:missing]` miss these: an object at the key **exists**, so missing-key warn never fires; `translateSingularElement` only writes known applicator fields (`textContent` / `title` / …), so a `{ main, confirm, … }` cluster bound via `data-i18n="….leave"` yields an empty control until a11y happens to mount it. CLI scripts use keys relative to `fountConsole.path` (e.g. `remove.removingFount`); reshape rewrites full paths and historically skipped `.sh`, so stale relative keys never turned red.

Rules:

- Element binding (`data-i18n`, `setElementI18n`): key must exist; objects need ≥1 applicator (`placeholder` / `title` / `label` / `value` / `alt` / `aria-label` / `textContent` / `innerHTML` / `dataset`). Prefer `.main` for “string plus sibling messages” clusters.
- String binding (`showToastI18n`, `confirmI18n`, `handleUIError`, …) and `path/fount.{ps1,sh}` `Get-I18n` / `get_i18n`: must resolve to a string (or tip array). Raw `geti18n` may return objects (e.g. `util.zxcvbn`); only missing keys fail.
- Static keys only (`a.b.c`); template interpolations skipped. Rewrite suffixes include `.sh` (shared `walk.mjs` / `reshape_i18n_keys.py`).

## Agent docs language

- `AGENTS.md` and agent-facing linked `.md`: English only (no CJK).
- Exempt: human-facing `docs/design/`, `docs/review/` (still walked for link resolution).
- Transitive local `.md` links must resolve.

## JSDoc English

- Summaries must include Latin letters and contain no CJK.
- List leftovers: `deno run -A ./src/scripts/checks/tools/scan_jsdoc_english.mjs` (optional path arg to narrow).
