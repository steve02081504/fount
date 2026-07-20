---
description: Shared local full-text search index (bigram + latin tokens, sharded inverted index)
globs: src/scripts/search/**, src/public/parts/shells/*/src/**/search*.mjs
alwaysApply: false
---

# Search Index Guide

## Engine (`src/scripts/search/`)

- **`tokenize.mjs`**: CJK → bigram; latin/digits → lowercased words; `#hashtag` kept whole. Bump `TOKENIZER_VERSION` on tokenization changes (triggers rebuild).
- **`invertedIndex.mjs`**: Per-shard `{indexDir}/{shardKey}/` — `postings.json`, append-only `docs.jsonl`, `meta.json`. Writes use `withAsyncMutex` per shard.
- **Query**: token intersection → candidates → **`verify` callback** substring check (kills bigram false positives).

## Hook points

| Shell | Incremental hook | Shard key |
| --- | --- | --- |
| Chat | `eventPersist.mjs` after `messages.jsonl` append | `channelId` |
| Social | `timeline/append.mjs` + `sync.mjs` ingest | `entityHash` |

Chat cold archive: lazy `ensureArchiveIndexed()` on first query touching uncovered months.

Social extras: `replies.json` reverse index + `trending.json` hashtag counts.
