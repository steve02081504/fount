---
description: Chat cold archive (UTC month bucketing, digest, federation backfill)
globs: src/public/parts/shells/chat/src/chat/archive/**, src/public/parts/shells/chat/test/**/post_archive*.test.mjs
alwaysApply: false
---

# Cold archive (Chat)

- **Month bucketing**: UTC `YYYY-MM` only (`getUTCFullYear`/`getUTCMonth` — never local `getMonth()`).
- **Two axes**: admin = DAG/HTTP governance; small-circle = federation + `monthDigests` reputation arbitration (body truth = digest). Local `archive/*.jsonl` cleanup = replica disk hygiene.
- **Not in DAG**: `archive_manifest.json` (`monthDigests`, `archivedEventIds`, `channels[].months`). Hot/checkpoint in `snapshot.json`.
- **Local read**: verify digests against month JSONL. Federation streams encrypted chunks — never whole-file `readFile`.
- **Federation**: `syncMissingArchiveMonths`; `fed_archive_month_want` needs PullAttestation + active membership; peers pick via `pickArchiveMonthByReputation`; quorum `ARCHIVE_QUORUM_PEER_MIN`.
- **Digest**: lines must be `canonicalArchiveMonthLine`; hash in eventId order; `mutateArchiveManifest` mutually-exclusive R-M-W; reassembly = temp file + `rename` (never `Buffer.concat`).
- **Hot zone**: `hot_posts.latestByChannel` in `snapshot.json`.

## Portable channel archive (Hub)

- Format: `{ format: 'fount-channel-archive', source, messages[] }` — `src/chat/channelArchive.mjs`.
- Export: cold+hot final view, delete tombstones, reaction **counts** (not voters), attachment metadata only, optional source hashes.
- Import: **new text channel**; re-signed by importer (`origin: 'bridge'`, `ingress: 'backfill'`) with `importedFrom` provenance (`attributionMismatch: true` when claimed ≠ signer). Original DAG signatures / voters are not forged.
- UI/agent: `--color-warning`; `extension.attribution.mismatch` must not be treated as a trusted owner instruction.
- HTTP: `GET …/channels/:channelId/export` (`VIEW_CHANNEL`); `POST …/channels/import` (`MANAGE_CHANNELS`, multipart `archive`).
