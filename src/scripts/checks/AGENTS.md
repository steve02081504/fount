---
description: Repo static health checks — suites, rules, and operator tools
globs: src/scripts/checks/**
alwaysApply: false
---

# Static Checks Guide

Manifest: `src/scripts/checks/test/manifest.json` (`checks`). Run: `fount test checks` / `checks:<suite>`.

| Suite | Enforces |
| --- | --- |
| `html_meta` | HTML meta / landmarks / `drawer-toggle` / aside ARIA; `og_meta_list` `under` prefix filter; pages readme/EULA redirect locales vs `docs/readme/` / `docs/EULA/` |
| `info` | parts `locales.json` / `achievements_registry.json` info + remote icon URL |
| `i18n_keys` | locale key structure + shared-path value kinds vs zh-CN + emoji.json must not carry Han/kana/Cyrillic |
| `i18n_refs` | `data-i18n` / `setElementI18n` objects need a DOM applicator; string APIs + `path/fount.{ps1,sh}` keys must resolve to strings |
| `reshape_i18n_keys` | `.esh/commands/reshape_i18n_keys.py --self-test` |
| `update_locales` | `.esh/commands/update-locales.py --self-test` (string↔single-applicator + string↔switch) |
| `agents_md_english` | `AGENTS.md` + linked `.md` English-only; non-`AGENTS.md` under `docs/` |
| `text_lf` | UTF-8 text (fatal decode, no NUL; empty files exempt) must be LF; text ends with exactly one LF (0 or multiple fail; single-line `.svg` must instead end with no LF); no leading LF (leading UTF-8 BOM skipped); under `fount test` scopes to triggered files when set. **Auto-fix**: running this suite first rewrites violating files via `fixTextLf` (normalize line endings, fix leading/trailing LF, preserve BOM), then re-scans to verify |
| `jsdoc_no_english` | JSDoc summaries: Chinese (CJK required; pure English flagged) |
| `locale_md_align` | Parallel `Stem.locale.md` families (`docs/EULA`, `docs/readme`): same line count; per-line heading / hr / quote / fence / list marker / bold / italic / link / image / inline-code counts vs `en-UK`. Same suite: EULA / README / `list.csv` / `locales/*.json` locale **ids** must be one set |
| `theme_radius` | Themed frontend (`src/public/**` + `.github/pages/**`, excl. `test/` and `.php.html` decoy pages) must not hardcode theme-controlled styling: Tailwind fixed-radius classes (`rounded`, `rounded-sm/md/lg/xl/2xl/3xl`, corner variants, **`rounded-full`** avatar circles, **daisyUI `btn-circle`** circular buttons), CSS `border-radius: <length>`, custom `--radius-*: <length>` var definitions (bypass theme — use `var(--radius-box)` etc.), or hardcoded border width `border: <px>` / `border-width: <px>` (bypass `--border`) — use theme-aware `rounded-selector` / `rounded-field` / `rounded-box` / `rounded-btn` / `rounded-badge`. Avatar circle and circular buttons must follow theme (square under cyberpunk) — use `btn-square` (equal-size, radius follows theme; not a hard square despite the name, see [saadeghi/daisyui#4687](https://github.com/saadeghi/daisyui/issues/4687)). Deliberately-thick decorative borders (avatar rings, status dots, emphasis bars) may keep px width with an above-line `/* theme-radius-ignore */` (skips only the next line) |
| `theme_color` | Themed frontend (same scope as `theme_radius`) must not use `var(<custom prop>, <hardcoded color>)` fallbacks on non-theme vars (`--bg-panel, #1e1e1e` etc. — page-local/undefined vars fall back to dark-theme colors, breaking light themes like the emoji-pack-preview card). Fallbacks must be theme vars (`var(--text-muted, var(--color-base-content))`) or dropped. Theme vars (`--color-*` / `--radius-*` / `--rounded-*` / `--border`) with literal fallbacks are safe. `*.user.js` (theme-less userscripts) excluded; an above-line `/* theme-color-ignore */` skips the next line |
| `daisyui_var` | Themed frontend (same scope as `theme_radius`) must use daisyUI semantic color vars in full spelling (`--color-base-100` / `--color-base-content` / `--color-primary` / `--color-warning` …), never the v4 abbreviations (`--b1` / `--b2` / `--b3` / `--bc` / `--p` / `--wa` …) — v5 keeps them as compat aliases only and components read `--color-*`, so hand-written abbreviations silently break. Comments are exempt; an above-line `/* daisyui-var-ignore */` skips the next line |
| `ms_literal` | Deno-runtime source (`src/scripts/**`, `src/server/**`, `path/**`, part `src/` + server-side `shared/`) must not hand-compute millisecond products (`N * 60 * 1000`, `N * 24 * 60 * 60 * 1000`, `N * 3600 * 1000`, …) — use `ms('…')` from `src/scripts/ms.mjs`. Browser-served code (`src/public/pages/`, part `public/`, `.github/pages/`) can't import the helper, so it's excluded; `*.test.mjs` / `*.spec.mjs` and the helper itself are excluded too |

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
- String binding (`showToastI18n`, `confirmI18n`, …) and path CLI / runner `Get-I18n` / `get_i18n` / `print_i18n_*`: must resolve to a string (or tip array). Raw `geti18n` may return objects; only missing keys fail. `handleError('key')` scanned only from frontend `features/errorHandlers.mjs` (not backend `scripts/errorHandlers.mjs`).
- Static keys only (`a.b.c`); skip template interpolations. Rewrite suffixes include `.sh`.

## Agent docs language

Enforced by `agents_md_english`; writing rules: [docs/AGENTS.md](../../../docs/AGENTS.md).

## JSDoc language (`jsdoc_no_english`)

- Summaries must be Chinese (contain CJK). Pure-English summaries fail.
- Tag-only blocks (`@param` / `@typedef` / … without a prose summary) are fine; empty `/** */` stubs are not a substitute for a real one-liner on re-exports.
- `extractJsdocBlocks` matches inline `/**` (e.g. `{ /** … */ prop`) as well as line-leading blocks; skips JSDoc-shaped text inside strings, templates, and ordinary line/block comments.
- List leftovers: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_jsdoc_no_english.mjs` (optional path arg).
- Locale markdown families: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_locale_md_align.mjs` (optional dir; default `docs/EULA` + `docs/readme`). Locale **id** sets: `fount test checks:locale_md_align` (`locale_sets.mjs`).

## HTML og meta tone

- Full-page `og:title` / `og:description` should carry imagery and rhetoric (see polished pages such as chat / login / wait).
- List all og meta: `deno run --allow-scripts --allow-all ./src/scripts/checks/tools/scan_og_meta_poetic.mjs` (optional subpath). Extraction: `og_meta_list.mjs`.
