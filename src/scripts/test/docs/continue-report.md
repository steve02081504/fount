# Run report — verdicts, plan, trigger reasons

Per-slot `continueReason` in `data/test/report.json` and `data/test/triggered-reasons.md` (linked from `report.md`) explain why each suite was included. Implementation: `runner/continue_reason.mjs` from the plan built by `core/plan.mjs`.

**CI** caches `data/test` as `fount-test-data` across pushes (strips logs/tmp/playwright/heapsnapshots/report).

## Verdict + plan

- `core/verdict.mjs` → `green` / `noisy` / `red` / `unknown`.
- `core/plan.mjs` → `reuse` / `run` / `blocked` + `subtestsToRun`.
- Fresh green/noisy/red → `reuse`. Goal red/noisy/unknown always **run**. Suite-level `failed` (e.g. watchdog) with all subtests still green/noisy elevates to **red** and full re-run. `--force` forces goals.
- Failed transitive dep with unchanged triggers stays `reuse(red)` and still **blocks**.
- Fingerprints (`commitHash` / `uncommittedHash` / `triggerHash`) update only after that suite's plan slot finishes (`upsertSuiteRun` on run, `refreshEntryFingerprint` on reuse) — never batch-align at wave start.

## Decision model

1. **`buildVerdicts`** — from state + git freshness. Suites with `subtests` aggregate and expose `subtestsToRun`. Dirty→clean `triggerHash` alone is not stale (`isTriggerHashStale`).
2. **Goals** — imperfect (`failed`/`blocked`/missing/fresh `noisy` + one-level dependents of hard fails only), outdated (`unknown`), or explicit / `--all`.
3. **`buildPlan`** — topo scan → each slot `reuse` | `run` | `blocked` with provenance.

Default `fount test` loops imperfect → outdated until both empty or a wave exits non-zero (`failed`/`blocked`/`noisy`/pending → exit 1). Fresh noisy is re-run in the imperfect wave; if still noisy after that wave, exit 1 (no same-invocation retry). Report `sectionNoisyPassed` lists them with log paths.

## Reason kinds

| `kind` | Meaning |
| --- | --- |
| `imperfect_failed` / `_noisy` / `_blocked` | Last state entry |
| `imperfect_dependent` | One-level downstream of an imperfect parent |
| `missing_state_record` | No entry in `state/main.json` |
| `stale_content` | Content changed since last run (path hits) |
| `trigger_hash_drift` | Fingerprint mismatch without path hits |
| `explicit_selected` | User named this suite / `--all` |
| `dependency_required` | Pulled in by plan expansion (`requiredBy`) |

## Suite-internal failure-first

`FOUNT_TEST_FIRST` lists last `failedFiles`. Run those first; if any still fail after the failure group, exit without the rest.

## Subtest timing

Playwright writes per-spec ms to `FOUNT_TEST_TIMINGS_OUT`. State stores per-subtest `durationMs`, suite `baselineOverheadMs`, and `baselineDurationMs` only on full runs. ETA uses `expectedRunDurationMs` = overhead + selected subtest baselines.
