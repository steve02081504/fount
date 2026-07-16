# Run report — trigger reasons

Per-slot `continueReason` in `data/test/report.json` and a **Trigger reasons** file (`data/test/triggered-reasons.md`, linked from `report.md` with a single line) explain why each suite was included. The details are split out to keep `report.md` scannable; `triggered-reasons.md` is removed when no slot carries a reason.

Implementation: `src/scripts/test/runner/continue_reason.mjs` formats reasons from the **plan** built by `core/plan.mjs`; goals come from `runner/selection.mjs`.

## Decision model (verdict + plan)

1. **`buildVerdicts`** (`core/verdict.mjs`) — one pass over all suites: `green` / `noisy` / `red` / `unknown` from state entries + git content freshness (commits since `entry.commitHash` + trigger-relevant uncommitted digest vs `entry.triggerHash`). Suites with `subtests` aggregate per-subtest verdicts (any unknown → unknown; else any red → red; else noisy/green) and expose `subtestsToRun`.
2. **Goals** — wave-specific `Set<key>`:
   - **imperfect**: failed/noisy/blocked/missing (+ one-level dependents)
   - **outdated**: verdict `unknown` in scope
   - **explicit / `--all`**: named or all suites in scope
3. **`buildPlan`** — single topo scan over goals + pulled dependencies → each slot is `reuse` | `run` | `blocked` with provenance and optional `subtestsToRun`.

Default `fount test` loops imperfect → (on green) outdated → imperfect until both empty or a wave fails (exit 1). Failures are **not** auto-retried in the same invocation.

Report slots, ETA estimate, dispatch, and trigger reasons all read the **same** plan — no second gate implementation.

## When reasons are stamped

| Scenario | Kinds |
| --- | --- |
| imperfect wave | `imperfect_*`, `imperfect_dependent`, `missing_state_record` on goal suites |
| outdated wave | `stale_content` on goal suites |
| Explicit suite + dependency pull | `explicit_selected`; `dependency_required` on pulled deps |

## Reason kinds

| `kind` | Meaning |
| --- | --- |
| `imperfect_failed` | Last state entry was `failed` |
| `imperfect_noisy` | Last state entry was `noisy` |
| `imperfect_blocked` | Last state entry was `blocked` |
| `imperfect_dependent` | One-level downstream of an imperfect parent |
| `missing_state_record` | No entry in `state/main.json` |
| `stale_content` | Content changed since last run (verdict `unknown`) |
| `explicit_selected` | User named this suite / `--all` |
| `dependency_required` | Pulled in by plan expansion — includes `requiredBy` |

## Evidence fields (`triggered-reasons.md`)

- **Required by** — for `dependency_required` (provenance from plan).
- **Commit range** / **uncommitted digest range** — for `stale_content` and imperfect kinds.
- **Blocked by** — for `imperfect_blocked` and plan `blocked` slots.
- **Matched trigger set** / **matched triggers** / **matched paths** — for `stale_content`.

## Suite-internal failure-first

`FOUNT_TEST_FIRST` lists last `failedFiles`. Runners (`serial.mjs`, `playwright/phases.mjs`) run those first; if any still fail after the failure group, exit without the rest. On all-green failure group, continue with remaining files/specs (optionally filtered by `FOUNT_TEST_SUBTESTS`).
