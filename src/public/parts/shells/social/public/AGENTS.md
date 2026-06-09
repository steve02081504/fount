# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI、`/api/parts/shells:social/...`、本机 timeline append 与 P2P deps 互信。
- **External untrusted**: `part_timeline_put`、`part_invoke`（Social RPC / timeline pull）；入站在 `timeline/sync.mjs`（`ingestRemoteTimelineEvent`）与 `timeline/federationExport.mjs`（联邦 pull 出站过滤）。
- **关注列表**: 无 sidecar JSON；从 operator 时间线物化 `following`；反向查询用 `data/social/follower_index/buckets/{hexPrefix}.json` 分桶投影（LRU 热缓存）。
- **拉黑**: 用户级 `settings/blocklist.json`，HTTP `/api/p2p/blocklist`。

## UI conventions

- 禁止面向用户的硬编码文案；使用 `data-i18n` 与 `zh-CN.json`（`social.*` 键）。
- 优先 `renderTemplate` / `mountTemplate`（`public/src/templates/`），避免大段 `` innerHTML ``。
- 模态框：沿用 `@src/public/pages/scripts/dialog.mjs` 的 `openDialogFromTemplate`（若适用）。

## 联邦 Social

- 远端通知 **仅**经 `part_invoke`（如 `social_on_mention`），不走 `char_rpc`。

## Related

- [Chat Hub AGENTS.md](../chat/public/hub/AGENTS.md)
- [Shell AGENTS.md](../AGENTS.md)
