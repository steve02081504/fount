---
description: Shared local full-text search index (bigram + latin tokens, sharded inverted index)
globs: src/scripts/search/**, src/public/parts/shells/*/src/**/search*.mjs
alwaysApply: false
---

# Search Index Guide

## Engine (`src/scripts/search/`)

- **`tokenize.mjs`**: CJK → bigram(2-gram); latin/digits → lowercased word tokens; `#hashtag` kept whole. Export `TOKENIZER_VERSION` — bump when tokenization changes (triggers rebuild).
- **`invertedIndex.mjs`**: Per-shard dir `{indexDir}/{shardKey}/` with `postings.json`, append-only `docs.jsonl`, `meta.json` (`coverage`, `docCount`, `watermark`). Writes use `withAsyncMutex` per shard.
- **Query path**: token intersection → candidate doc ids → **`verify` callback** substring truth check (eliminates bigram false positives).

## Hook points

| Shell | Incremental hook | Shard key |
| --- | --- | --- |
| Chat | `eventPersist.mjs` after `messages.jsonl` append | `channelId` |
| Social | `timeline/append.mjs` + `sync.mjs` ingest | `entityHash` |

Chat cold archive: lazy scan in `chat/search/index.mjs` `ensureArchiveIndexed()` on first query touching uncovered months.

Social extras: `searchIndex.mjs` maintains `replies.json` reverse index + `trending.json` hashtag counts.

## Tests

- Pure: `shells/social/test/pure/search_engine.test.mjs`
- Integration: `shells/chat/test/integration/search_index.test.mjs`, `shells/social/test/integration/governance.test.mjs` (indirect)
