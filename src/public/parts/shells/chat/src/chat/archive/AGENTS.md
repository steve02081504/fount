---
description: Chat cold archive (UTC month bucketing, digest, federation backfill)
globs: src/public/parts/shells/chat/src/chat/archive/**, src/public/parts/shells/chat/test/**/post_archive*.test.mjs
alwaysApply: false
---

# Cold archive (Chat)

- **Month bucketing**: UTC calendar month `YYYY-MM` only (`archiveMonthKey` uses `getUTCFullYear`/`getUTCMonth`; never local-time `getMonth()`).
- **Two axes**: admin axis = DAG/HTTP governance; small-circle axis = federation multi-peer + `monthDigests` reputation arbitration (body truth = digest). Local cold-archive cleanup = replica disk hygiene — any user with a local group replica may delete `archive/*.jsonl`.
- **Not in DAG**: `archive_manifest.json` holds `monthDigests`, `archivedEventIds`, `channels[].months`. Hot/checkpoint state in `snapshot.json`.
- **Local disk read**: verify `monthDigests` against month JSONL; federation streams encrypted chunks, never whole-file `readFile`.
- **Federation**: `syncMissingArchiveMonths` backfills; `fed_archive_month_want` requires PullAttestation + active membership; peers arbitrate digests via `pickArchiveMonthByReputation`, then `syncArchivedEventIdsFromMonthBody`; quorum via `ARCHIVE_QUORUM_PEER_MIN` (`federationCollect.mjs`).
- **Digest**: each disk JSONL line must be `canonicalArchiveMonthLine`; `digestCanonicalMonthLines` hashes lines in eventId order; `mutateArchiveManifest` does mutually-exclusive R-M-W; federation reassembly writes temp file then `rename`, never `Buffer.concat`.
- **Hot zone**: `hot_posts.latestByChannel` in `snapshot.json` (`hotLatestMessageCount`).

## Portable channel archive (Hub)

- Format: `{ format: 'fount-channel-archive', version: 2, source, messages[] }` — see `src/chat/channelArchive.mjs`（校验仍接受 v1）。
- Export includes cold+hot final view, delete tombstones, reaction **counts** (not voters), attachment metadata only (no bytes), plus optional `sourceSenderPubKeyHash` / `sourceEntityHash`.
- Import creates a **new text channel** in the current group; history is re-signed by the importer (`origin: 'bridge'`, `ingress: 'backfill'`) with `importedFrom` provenance（含 claimed/signer + `attributionMismatch: true`）。Original DAG signatures / reaction voters are not forged.
- Hub UI：人名旁 `--color-warning` 图标；人物卡姓名下警告框。Agent / Prompt：`extension.attribution.mismatch` → 不可视为主人指令。
- HTTP: `GET …/channels/:channelId/export` (`VIEW_CHANNEL`); `POST …/channels/import` (`MANAGE_CHANNELS`, multipart `archive`).
