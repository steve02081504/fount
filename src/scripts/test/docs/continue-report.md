# Run report — trigger reasons

Per-slot `continueReason` in `data/test/report.json` and a **Trigger reasons** file (`data/test/triggered-reasons.md`, linked from `report.md` with a single line) explain why each suite was included — not only for `--continue`. The details are split out to keep `report.md` scannable; `triggered-reasons.md` is removed when no slot carries a reason.

Implementation: `src/scripts/test/runner/continue_reason.mjs`, stamped by `RunReportWriter` / `runner/index.mjs`.

## When reasons are stamped

| Scenario | Kinds |
| --- | --- |
| `--continue` pending slots | `pending_from_previous_report` |
| `--continue` imperfect suites | `imperfect_*`, `outdated_trigger_hit`, … |
| Explicit suite + dependency expansion | `explicit_selected` on named suites; `dependency_required` on non-green upstream only |
| Diff selection (no explicit suite names) | `diff_trigger_hit` on diff-selected suites; `dependency_required` on expanded deps |

## Selection order (`--continue`)

1. **Pending slots** — unfinished slots from the last report (`pending_from_previous_report`).
2. **Imperfect suites** — failed, noisy, blocked, missing state record, or trigger-outdated at the current fingerprint.
3. **Commit-stale suites** — passed at an older commit with trigger-fresh triggers (`commit_mismatch`); only when steps 1–2 found nothing.

Dependency expansion may add suites not in the seed set; those get `dependency_required` with a best-effort `requiredBy` key (transitive reverse-walk to the nearest seed suite). **Commit drift alone never activates indirectly pulled suites** — only failed / missing / trigger-outdated upstream deps expand.

- **Upstream pull** — child suite selected but a non-green dependency must run first (`requiredBy` = the user/diff-selected suite that ultimately needed it).
- **Downstream pull** — parent suite was outdated and `expandWithDependents` added a dependent (`requiredBy` = the outdated parent).

## Reason kinds

| `kind` | Meaning |
| --- | --- |
| `pending_from_previous_report` | Slot was still `pending` when the prior run stopped |
| `imperfect_failed` | Last state entry was `failed` |
| `imperfect_noisy` | Last state entry was `noisy` |
| `imperfect_blocked` | Last state entry was `blocked` |
| `missing_state_record` | No entry in `state/main.json` |
| `outdated_trigger_hit` | Trigger files changed since the recorded commit |
| `diff_trigger_hit` | Included by uncommitted diff trigger matching |
| `commit_mismatch` | Passed at a different commit (seed only: explicit selection or `--continue` with no imperfect suites) |
| `dependency_required` | Pulled in by dependency expansion — includes `rootKey`, `inclusionPath`, `pull`, and `gate` |

## Evidence fields (`triggered-reasons.md`)

- **Root cause** / **inclusion path** / **pull direction** / **gate reason** — for `dependency_required` (root seed reason, chain from seed, upstream vs downstream, why the dep gate was not green).
- **Commit range** / **uncommitted digest range** — fingerprint drift.
- **Blocked by** — for `imperfect_blocked`.
- **Matched triggers** / **matched paths** — for `outdated_trigger_hit` (from `collectTriggerEvidence` in `core/state.mjs`).
- **Required by** — for `dependency_required`.
