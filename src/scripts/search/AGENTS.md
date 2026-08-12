---
description: Shared local full-text search index (bigram + latin tokens, sharded inverted index)
globs: src/scripts/search/**, src/public/parts/shells/*/src/**/search*.mjs
alwaysApply: false
---

# Search Index Guide

Shard I/O edges / trending fill: [docs/index-io.md](docs/index-io.md).

## Engine (`src/scripts/search/`)

- **`tokenize.mjs`**: CJK → bigram; latin/digits / `#hashtag` → **lowercase posting keys** (inverted-index map keys need one canonical form; `/i` cannot replace key lookup). UI substring filters elsewhere use `RegExp(..., 'i')` instead of pre-lowering haystacks. Bump `TOKENIZER_VERSION` on tokenization changes (triggers rebuild).
- **`invertedIndex.mjs`**: Per-shard `{indexDir}/{shardKey}/` — `postings.json`, append-only `docs.jsonl`, `meta.json`. Writes use `withAsyncMutex` per shard.
- **Query**: token intersection → candidates → **`verify` callback** substring check (kills bigram false positives).

## Hook points

| Shell | Incremental hook | Shard key |
| --- | --- | --- |
| Chat | `eventPersist.mjs` after `messages.jsonl` append | `channelId` |
| Social | `timeline/append.mjs` + `sync.mjs` ingest | `entityHash` |

Chat cold archive: lazy `ensureArchiveIndexed()` on first query touching uncovered months.

Social extras: `replies.json` reverse index + `trending.json` hashtag counts.
