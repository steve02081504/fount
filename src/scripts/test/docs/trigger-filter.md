# Trigger filter

Verdict freshness, outdated-wave evidence, and continue-report trigger evidence all filter changed paths before glob matching. Implementation: `core/trigger_filter.mjs`.

## Default ignores

| Pattern | Examples |
| --- | --- |
| `**/AGENTS.md` | part guides |
| `**/test/manifest.json` | suite metadata (editing manifest alone no longer runs all suites) |
| `**/docs/**`, `**/*.md` | docs and markdown (incl. repo root) |
| `**/llms.txt` | llms context files |

Test-infra changes under `src/scripts/test/` auto-select **`testkit`** suites plus any suite whose manifest trigger explicitly watches the changed path — not the whole repo.

## `triggerFilter` field

Set on manifest root or individual suite. Suite layer merges on top of manifest.

```json
{
 "triggerFilter": { "ignoreDefaults": false },
 "suites": [{
  "name": "docs-check",
  "triggerFilter": { "unignore": ["src/public/parts/foo/**/*.md"] }
 }]
}
```

| Field | Effect |
| --- | --- |
| `ignoreDefaults: false` | drop the default ignore table; only custom `ignore` / `unignore` apply |
| `ignore` | extra globs to exclude (manifest + suite lists concatenated) |
| `unignore` | globs that must participate; checked first, wins over both defaults and `ignore` |

## Locale triggers

`src/public/locales/*.json` and `list.csv` belong on **`checks` only** (`i18n_keys` / `i18n_refs` / `locale_md_align`). Do not hang `src/public/locales/**` on Playwright (smoke, jsonEditor, page-watch) or path CLI — those re-run when the page/widget/CLI **code** changes. jsonEditor aria-label wiring is `i18n_refs` (key + applicator) plus the editor spec when the widget changes. Enforced by `testkit:trigger_audit`.

`frontendShared` on multi-subtest shells is harness only (`fixtures` / `run` / `phases` / `playwright.config` + Playwright helpers). Spec files live on that subtest — do not use `test/frontend/**` at suite level or changing one spec re-runs every sibling.

## Test harness triggers

`src/scripts/test/node/**` (launch/boot/worker), `serial.mjs`, and helpers like `allowNoise` / `url` belong on **`testkit`** (and `pure` / `integration` may watch `serial.mjs` / `boot.mjs`). Product **`live`** suites watch the server and that suite's own tests — not the harness. Changing launch must not stale `server:live`; `testkit:launch_node` covers it. Enforced by `testkit:trigger_audit`.
