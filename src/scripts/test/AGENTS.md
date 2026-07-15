---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics
globs: src/scripts/test/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework Guide

Domain-specific traps (chat federation, P2P/WebRTC, etc.) belong in each part's own guide — not here.

## Architecture

- **Entry**: `fount test` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `fount/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid.
- **Run report**: `data/test/report.md` + `report.json` — last run only. **Suite sum** = non-reused slot durations; **wall clock** = run span; **parallel rate** = suite sum / wall clock × 100% − 100% (≈0% serial, higher = more parallelism). Trigger reasons in `data/test/triggered-reasons.md`. `--continue` details: [continue-report.md](docs/continue-report.md).
- **`--outdated`**: verdict `unknown` (content changed or never run).
- **`--no-parallel`**: serial suite dispatch **and** inner file concurrency = 1 (`FOUNT_TEST_BUDGET_CORES=1` via `serial.mjs`). **Default for agents on Windows** and for local verification / `--continue` reruns. Parallel `deno run`/`deno test` children against the same cwd with `nodeModulesDir: auto` + `lock: false` can corrupt `node_modules` (missing entrypoints, junction errors, native addon `EBUSY`) — [denoland/deno#35804](https://github.com/denoland/deno/issues/35804). See [resource-scheduling.md](docs/resource-scheduling.md).
- **Verdict + plan**: `core/verdict.mjs` builds one freshness verdict per suite (`green`/`noisy`/`red`/`unknown`); `core/plan.mjs` turns goals + verdicts into `reuse`/`run`/`blocked` slots with provenance. **`reuse`** when verdict is `green`/`noisy`/`red` and content is still fresh; on reuse, `refreshEntryFingerprint` updates `commitHash`/`uncommittedHash` so diff scope does not grow forever. **`--force`** downgrades **selected goal** `reuse` → `run` only — a failed transitive dep with unchanged triggers stays `reuse(red)` and still **blocks** the goal. To re-verify after fixing code outside that dep's trigger watch, include the dep in the selector (e.g. `fount test --force server/live shells/chat:fed_entity_search`) or touch a watched path.
- **`dependsOn`**: runtime gate via plan — downstream `blocked(by)` when a dependency's plan action is not green-capable. Selector: `manifest:suite` or `manifest/suite` (`core/selector.mjs`, longest manifest prefix).
- **Suite selectors** (`manifest:suite`): a selector that is itself a full suite id/name is exact — `shells/chat:fed_emoji` runs only `fed_emoji`, never `fed_emoji_nearcache`/`_nonmember`. Prefix expansion (`fed` → `fed_*`) only kicks in when no suite is named exactly that. Explicit `*`/`?` always globs. (Dependencies still pull in via `dependsOn`, that's not prefix matching.)
- **Ordering & dispatch**: manifest list order, `report.md` slot order, and serial-vs-parallel dispatch share the same topo + tie-break rules. Details: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after.

### Framework libs

| Module | Role |
| --- | --- |
| `live/deno_run.mjs` | `denoLiveRun()` argv builder |
| `live/http.mjs` | fetch, multipart, `PollUntil` / `sleep` |
| `live/env.mjs` | `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` |
| `core/state.mjs` | state DB read/write/upsert, fingerprint refresh |
| `core/verdict.mjs` | one-pass suite verdicts (green/noisy/red/unknown) |
| `core/plan.mjs` | goals + verdicts → reuse/run/blocked plan |
| `core/selector.mjs` | `manifest:suite` / `manifest/suite` resolution |
| `core/dependencies.mjs` | `dependsOn` resolve, topo sort, diff one-level dependents |
| `core/deno_panic.mjs` | detect `Deno has panicked` in suite output → gh auto-issue |
| `runner/suite_run.mjs` | `buildSuiteInvocation` / `runSuite` |
| `runner/continue_reason.mjs` | `--continue` slot reasons → report |

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP route suites — see below) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (pulls in the P2P/native graph; Deno child-process exit can hang on Windows). When server access is required, use dynamic import or promote to an `integration/` suite.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: diff selection — glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). **Watch scope** = code this suite actually runs against — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`; live suites use but do not watch them). No `federation/**` on every fed feature suite — only `fed_core`. Cross-part deps: narrow paths; for P2P package changes watch `deno.json` or `src/server/p2p_server/**`.
- **`dependsOn`**: plan pulls transitive deps; downstream `blocked` when upstream is not green-capable in the plan. **Diff**: direct trigger hits only (no downstream expansion). **Continue**: `failed`/`noisy`/`blocked`/`missing_state_record` + one-level `expandImperfectDependents` — **not** stale `unknown`. **`--outdated`**: explicit stale refresh. Fresh upstream `reuse` does not block downstream.
- **Live layering** (avoid re-probing the same failure in every suite): `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_ext` / `frontend`; Social: `server:live` → `smoke_social` → `e2e_single` → `frontend` (`integration/posts_http` covers HTTP POST before live); WS chain `ws` → `ws_rpc` → `ws_stream` (`av_relay` after `ws`); federation `fed_core` → feature suites; cross-shell fed probes depend on `shells/chat:fed_core` + `fed_emoji` + `smoke_social`, not full social e2e.
- **Browser scripts**: paths under `/scripts/*` map to `src/public/pages/scripts/` (e.g. `/scripts/test/ready_gate.mjs` → `public/pages/scripts/test/ready_gate.mjs`; Chat/Social P2P and mention/avatar primitives live in `shells/chat/public/shared/` or `/parts/shells:chat/shared/*`. Do not import `/scripts/test/*` from Deno-only trees.
- **`heavy`**: machine-exclusive scheduling — [resource-scheduling.md](docs/resource-scheduling.md).
- **`resources`**: optional `{ "memMb", "cpuPct" }`; omitted fields use heuristics + learned baselines.

## New live tests

- Deno `.mjs` via `denoLiveRun(path)` or a part-local `run.mjs` — no PowerShell probes.
- **WebSocket frame wait**: `live/wsHarness.mjs` — `waitForWsFrame({ url, types, trigger, timeoutMs })`: optionally call `trigger()` to fire an HTTP action after connect, returns `{ ok: true }` on first matching frame type, `{ ok: false }` on timeout/error. Shared by Chat and Social live WS probes — do not write custom polling loops.
- **Permission flags invariant**: every deno `run`/`test`/`install` invocation carries both `--allow-scripts --allow-all`, in that order. `--allow-scripts` builds native addons (argon2, node-datachannel, etc.) via npm postinstall; omitting it leaves `build/Release/*.node` empty. **Sole exception**: `deno cache` takes `--allow-scripts` alone (no `--allow-all` flag).
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse (common on Windows). Federation live requires a `node-datachannel` native build; `--allow-scripts` handles this automatically on first run — no manual install after clone.
- Single-node: `{ p2p: false, minP2pNode: true }`. P2P signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md).
- Federation live probes: reuse `InitializeOpenGroupJoin` / `InitializeOpenGroupJoinMulti` from `live/federation/common.mjs` (they bundle `WarmupFedNodeLinks` → `rebind` → members gate → re-invite fallback). A hand-rolled bare join (create → invite → join) with no warmup/rebind will hang at `members>=2`. A `members>=2` hang is usually a real link/handshake or ICE bug — inspect handshake/ICE logs before rerunning (signaling traps: [p2p/docs/signaling.md](../p2p/docs/signaling.md)).
- Federation convergence assertions should prefer semantic helpers (`TestFedHasMessage`, `TestFedHasReaction`, etc.) over raw `GET /events?limit=...` scans: event streams are paged/windowed and can miss the target row even when ingestion succeeded, causing false negatives.
- **HTTP route integration (`launchNode`)**: spawn an isolated node (`fount/scripts/test/node/launch.mjs`), seed fixtures via env scenario + bootstrap worker (e.g. `shells/chat` `routes_http.test.mjs` + `FOUNT_TEST_HTTP_SCENARIO` → `routes_http_bootstrap.mjs`), then `fetch` against `http://127.0.0.1:{port}/api/parts/shells:chat/...?fount-apikey=…`.
- **Chat message content after `postChannelMessage`**: returned `event.content` is often CKG-encrypted (`scheme: 'ckg'`); assert extras (`locale` / `content_warning`) via `readChannelMessagesForUser` decrypted rows, not the wire event.
- **`message_edit` 不留在 `events.jsonl`**：`foldDagProcessEvents` 在 checkpoint rebuild 时会无条件折叠掉 `message_edit`（进频道侧车 + 物化 overlay）。集成测断言编辑结果应走 `readChannelMessagesForUser` + `mergeChannelMessagesForDisplay`，不要扫 `events.jsonl` 找 `type===message_edit'`。
- **In-process integration (`createTestServerBoot`)**: long-lived same-process server with no teardown. `node/boot.mjs` patches `Deno.test` on import to default `sanitizeOps`/`sanitizeResources: false`, otherwise leftover timers/handles flip a green file to exit 1 (suite reports “N files passed” then still fails). Prefer importing harness/`boot.mjs` before any `Deno.test(...)` registration.
- **Disposable data paths only**: tests must never point `dataDir`/`dataPath` at the repo's real `data/` root (or any other production state). `assertDisposableDataPath` (`core/disposable_path.mjs`) throws unless the path resolves under OS `tmpdir()` or `{repo}/data/test`; wired into `startTestServer`, `bootInProcess({ resetData: true })`, and `stopNode` cleanup. 2026-07-13 incident: a test set `dataDir = join(fountRoot, 'data')` and `resetData` wiped the operator's whole tree.
- **`--no-parallel` + `serial.mjs`**: orchestrator sets `FOUNT_TEST_BUDGET_CORES=1` so inner file concurrency is 1. Each finished file prints `[serial] ok …` so idle watchdog does not kill long all-silent suites. If you see `Blocking waiting for file lock on node_modules directory` or flaky `ERR_MODULE_NOT_FOUND` under parallel runs, rerun with `--no-parallel` ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). Long serial runs can still corrupt mid-suite (e.g. nested npm `NotFound: call-bind-apply-helpers` via `dunder-proto` while earlier files passed): `deno cache --reload` the missing package (or wipe/reinstall the broken `.deno` store entry), then re-run **only** the failed file via `serial.mjs` — do not treat as product regression without a second green pass.
- **Agent entityHash in tests**：禁止路径派生（旧 `agentEntityHash(node, 'chars/X')` 已删）。有 username 时用 `ensureLocalAgentEntityHash` / `ensureAgentEntityIdentity`；纯构造假身份用 `keyPairFromSeed` + `entityHashFromRecoveryPubKeyHex`。Social 入站对远端 owner 会 `maintainSocialTimeline` → `rebuildSignedTimelineSnapshot`，后者须容忍无本地 identity（勿让 `getEntitySecretKey` 抛穿）。
- **Social → chat 相对导入**：从 `shells/social/src/endpoints/` 引用 chat 后端用 `../../../chat/...`（`../../../../chat` 会落到 `parts/chat` 导致 Load 炸掉）。
- **Per-entity 默认空结构**：`loadX` 在文件缺失时若 `return { ...DEFAULT }`（浅拷贝），嵌套数组/对象会跨调用方共享并污染——导致「实体 A 写入 → 实体 B 未落盘却读到 A 的数据」。默认值必须每次新建（如 `{ folders: {}, unfiled: [] }` / `structuredClone`），集成隔离测（`entity_parity` / `entity_private_state`）会立刻抓出这类问题。

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report** (`core/deno_panic.mjs`): on `Deno has panicked` in suite output, files a GitHub issue on `denoland/deno` if `gh` is installed; dedup in `data/test/deno_panics.json`. `parseDenoPanic` folds multiline messages until `stack backtrace:`; `fitGhIssueTitle` fits GitHub's 256-char title cap (shrink `(xxx)` in summary, then truncate). All test child spawns use `childEnv()` / explicit `RUST_BACKTRACE=full`. Override target repo via `FOUNT_DENO_PANIC_REPO`. `testkit` suites are excluded so fixtures don't fire real reports.
- **Selftests**: `selftest/` — `fount test testkit`. One suite per `*.test.mjs` (suite name = file basename). **Fixtures**: shared builders in `selftest/fixtures.mjs` — `makeSuite(manifestId, name, { dependsOn, triggers, ...rest })` and `makeStateEntry(overrides)`; reuse them, never re-declare per-file stubs. **Lint**: `jsdoc/require-jsdoc` demands a JSDoc block on every function with `@param` types + `@returns`; `import/order` requires a blank line between `../` and `./` groups, alphabetical within — fix import order by hand (eslint 10 crashes on fixable violations). Keep manifest id `testkit` — the panic auto-report skip keys on it.
- **Naming**: prefer readable identifiers in framework code — `context` not `ctx`, `core/dependencies.mjs` not `deps.mjs`, `dependencyEdges` not `deps`. Suite / file / fixture / `Deno.test` names and comments must use domain semantics — never planning milestone codes (`M1`/`M7a`/`G4`, etc.); milestones belong only in design docs.
