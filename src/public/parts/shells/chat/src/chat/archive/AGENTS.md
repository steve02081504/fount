---
description: Chat cold archive (UTC month bucketing, digest, federation backfill)
globs: src/public/parts/shells/chat/src/chat/archive/**, src/public/parts/shells/chat/test/**/post_archive*.test.mjs
alwaysApply: false
---

# Cold archive (Chat)

- **Month bucketing**: UTC calendar month `YYYY-MM` only (`archiveMonthKey` uses `getUTCFullYear`/`getUTCMonth`; never local-time `getMonth()`).
- **Two axes**: admin axis = DAG/HTTP governance (kick, delete post, channel permissions); small-circle axis = federation multi-peer + `monthDigests` reputation arbitration (body truth = digest, not admin Seal). Local cold-archive cleanup = replica disk hygiene; any user with a local group replica may delete `archive/*.jsonl` — ADMIN not required.
- **Not in DAG**: `archive_manifest.json` holds `monthDigests`, `archivedEventIds`, `channels[].months` (backfill hints). Hot/checkpoint state in `snapshot.json` (`checkpoint_event_id`, `hot_posts`).
- **Local disk read**: Hub/reader verifies `monthDigests` against month JSONL; federation streams encrypted chunks, never whole-file `readFile`.
- **Federation**: join carries wire manifest (month/digest hints only); `syncMissingArchiveMonths` backfills; `fed_archive_month_want` requires PullAttestation + active membership; peers arbitrate digests via `pickArchiveMonthByReputation`/`pickNodeScoreFromReputation`, write, then `syncArchivedEventIdsFromMonthBody`; collection ends at quorum (≥2 peers same digest, `ARCHIVE_QUORUM_PEER_MIN`) or all target peers collected (`federationCollect.mjs`).
- **Digest**: each disk JSONL line must be `canonicalArchiveMonthLine`; `digestCanonicalMonthLines` hashes lines in eventId order; `mutateArchiveManifest` does mutually-exclusive R-M-W; federation reassembly writes temp file then `rename`, never `Buffer.concat`.
- **Hot zone**: `hot_posts.latestByChannel` in `snapshot.json` (latest N per channel, `hotLatestMessageCount`).
