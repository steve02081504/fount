# Trigger filter

Diff selection (`selectSuitesByDiff`), `--outdated`, and continue-report trigger evidence all filter changed paths before glob matching. Implementation: `core/trigger_filter.mjs`.

## Default ignores

| Pattern | Examples |
| --- | --- |
| `**/AGENTS.md` | part guides |
| `**/test/manifest.json` | suite metadata (editing manifest alone no longer runs all suites) |
| `**/docs/**`, `**/*.md`, `*.md` | docs and root-level markdown |
| `**/llms.txt` | llms context files |

Test-infra changes under `src/scripts/test/` still rerun every suite when the filtered path hits that prefix.

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
