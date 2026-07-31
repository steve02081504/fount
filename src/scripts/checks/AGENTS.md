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
| `reshape_i18n_keys` | `.esh/commands/reshape_i18n_keys.py --self-test` |
| `agents_md_english` | `AGENTS.md` + agent-facing linked `.md` English-only |
| `jsdoc_english` | JSDoc summaries: Latin letters, no CJK |

## i18n keys

- No `Suffix` / `Prefix` affix keys.
- No ≥4 flat camelCase siblings sharing a prefix.
- No `xxx1`-style numbered keys.
- Prefix-nest **writeback** only via `.esh/commands/reshape_i18n_keys.py` (JS `JSON.stringify` reorders numeric keys like `404`). Root [AGENTS.md](../../../AGENTS.md) I18n covers day-to-day locale edits.

## Agent docs language

- `AGENTS.md` and agent-facing linked `.md`: English only (no CJK).
- Exempt: human-facing `docs/design/`, `docs/review/` (still walked for link resolution).
- Transitive local `.md` links must resolve.

## JSDoc English

- Summaries must include Latin letters and contain no CJK.
- List leftovers: `deno run -A ./src/scripts/checks/tools/scan_jsdoc_english.mjs` (optional path arg to narrow).
