# Run report — trigger reasons

Per-slot `continueReason` in `data/test/report.json` and a **Trigger reasons** file (`data/test/triggered-reasons.md`, linked from `report.md` with a single line) explain why each suite was included — not only for `--continue`. The details are split out to keep `report.md` scannable; `triggered-reasons.md` is removed when no slot carries a reason.

Implementation: `src/scripts/test/runner/continue_reason.mjs` formats reasons from the **plan** built by `core/plan.mjs`; goals come from `runner/selection.mjs`.

## Decision model (verdict + plan)

1. **`buildVerdicts`** (`core/verdict.mjs`) — one pass over all suites: `green` / `noisy` / `red` / `unknown` from state entries + git content freshness (commits since `entry.commitHash` + trigger-relevant uncommitted digest vs `entry.triggerHash`). This is the **only** freshness definition.
2. **Goals** — mode-specific `Set<key>` (`--continue`, diff, explicit, `--outdated`, `--all`).
3. **`buildPlan`** — single topo scan over goals + pulled dependencies → each slot is `reuse` | `run` | `blocked` with provenance (who pulled whom).

Report slots, ETA estimate, dispatch, and trigger reasons all read the **same** plan — no second gate implementation.

## When reasons are stamped

| Scenario | Kinds |
| --- | --- |
| `--continue` | `imperfect_*`, `imperfect_dependent`, `missing_state_record` on goal suites |
| `--outdated` | `stale_content` on goal suites |
| Explicit suite + dependency pull | `explicit_selected`; `dependency_required` on pulled deps |
| Diff selection | `diff_trigger_hit`; `dependency_required` on pulled deps |

There is **no** `pending_from_previous_report`: interrupted runs resume via `--continue` re-deriving goals from imperfect verdicts (stale `unknown` uses `--outdated`).

## Reason kinds

| `kind` | Meaning |
| --- | --- |
| `imperfect_failed` | Last state entry was `failed` |
| `imperfect_noisy` | Last state entry was `noisy` |
| `imperfect_blocked` | Last state entry was `blocked` |
| `imperfect_dependent` | One-level downstream of an imperfect parent |
| `missing_state_record` | No entry in `state/main.json` |
| `stale_content` | Content changed since last run (verdict `unknown`; `--outdated` only) |
| `diff_trigger_hit` | Included by diff trigger matching |
| `explicit_selected` | User named this suite |
| `dependency_required` | Pulled in by plan expansion — includes `requiredBy` |
| `failure_retry` | Narrowed re-run of failed files (run-time, not selection) |

## Evidence fields (`triggered-reasons.md`)

- **Required by** — for `dependency_required` (provenance from plan).
- **Commit range** / **uncommitted digest range** — for `stale_content` and imperfect kinds.
- **Blocked by** — for `imperfect_blocked` and plan `blocked` slots.
- **Matched trigger set** / **matched triggers** / **matched paths** — for `stale_content` and `diff_trigger_hit`.
