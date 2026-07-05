# Continue run report

`fount test --continue` writes per-slot `continueReason` into `data/test/report.json` and a **Continue reasons** section in `report.md`.

Implementation: `src/scripts/test/runner/continue_reason.mjs`, stamped by `RunReportWriter` / `selection.mjs`.

## Selection order

1. **Pending slots** — unfinished slots from the last report (`pending_from_previous_report`).
2. **Imperfect suites** — failed, noisy, blocked, missing state record, or trigger-outdated at the current fingerprint.

Dependency expansion may add suites not in the imperfect set; those get `dependency_required` with a best-effort `requiredBy` parent key.

## Reason kinds

| `kind` | Meaning |
| --- | --- |
| `pending_from_previous_report` | Slot was still `pending` when the prior run stopped |
| `imperfect_failed` | Last state entry was `failed` |
| `imperfect_noisy` | Last state entry was `noisy` |
| `imperfect_blocked` | Last state entry was `blocked` |
| `missing_state_record` | No entry in `state/main.json` |
| `outdated_trigger_hit` | Trigger files changed since the recorded commit |
| `dependency_required` | Pulled in by `dependsOn` expansion for an imperfect parent |

## Evidence fields (report markdown)

- **Commit range** / **uncommitted digest range** — fingerprint drift.
- **Blocked by** — for `imperfect_blocked`.
- **Matched triggers** / **matched paths** — for `outdated_trigger_hit` (from `collectTriggerEvidence` in `core/state.mjs`).
- **Required by** — for `dependency_required`.
