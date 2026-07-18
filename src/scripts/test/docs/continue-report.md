# Run report — trigger reasons

Per-slot `continueReason` in `data/test/report.json` and `data/test/triggered-reasons.md` (linked from `report.md`) explain why each suite was included. Implementation: `runner/continue_reason.mjs` from the plan built by `core/plan.mjs`.

## Decision model

1. **`buildVerdicts`** — `green` / `noisy` / `red` / `unknown` from state + git freshness. Suites with `subtests` aggregate and expose `subtestsToRun`.
2. **Goals** — imperfect (failed/noisy/blocked/missing + one-level dependents), outdated (`unknown`), or explicit / `--all`.
3. **`buildPlan`** — topo scan → each slot `reuse` | `run` | `blocked` with provenance.

Default `fount test` loops imperfect → (on green) outdated → imperfect until both empty or a wave fails (exit 1).

## Reason kinds

| `kind` | Meaning |
| --- | --- |
| `imperfect_failed` / `_noisy` / `_blocked` | Last state entry |
| `imperfect_dependent` | One-level downstream of an imperfect parent |
| `missing_state_record` | No entry in `state/main.json` |
| `stale_content` | Content changed since last run |
| `explicit_selected` | User named this suite / `--all` |
| `dependency_required` | Pulled in by plan expansion (`requiredBy`) |

## Suite-internal failure-first

`FOUNT_TEST_FIRST` lists last `failedFiles`. Run those first; if any still fail after the failure group, exit without the rest.

## Subtest timing

Playwright writes per-spec ms to `FOUNT_TEST_TIMINGS_OUT`. State stores per-subtest `durationMs`, suite `baselineOverheadMs`, and `baselineDurationMs` only on full runs. ETA uses `expectedRunDurationMs` = overhead + selected subtest baselines.
