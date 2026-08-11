# Search index I/O edges

Day-to-day: [AGENTS.md](../AGENTS.md).

## Shard directory lifecycle

- Shard dirs are created leaf-by-leaf (no recursive parent revive).
- Docs append does not `mkdir` (avoids `appendJsonlSynced` resurrecting deleted trees).
- Gone parent / mid-write `ENOENT`/`EEXIST` → no-op.
- Windows `EPERM` only when `indexDir` is confirmed missing — not `EBUSY` (that is a live lock, not gone-parent).

## Social trending display

`readTrendingHashtagCounts` drops empty tags then fills to `limit` from remaining live ranked entries; `buildTrendingHashtags` live-scans if still short.
