# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Timeline ingress at `src/timeline/sync.mjs` (`ingestRemoteTimelineEvent`); social RPC ingress at `src/discovery.mjs` (`handleSocialRpc`); outbound filtering on federation pull in `src/timeline/federationExport.mjs`.
- **Follow list**: no sidecar JSON; `following` is materialized from the operator timeline; reverse lookups use `{dataPath}/p2p/node/social/follower_index/buckets/{hexPrefix}.json` bucketed projection (LRU hot cache).
- **Block**: node-level `{dataPath}/p2p/node/blocklist.json`, HTTP `/api/p2p/blocklist`.

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` (`public/src/templates/`) over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/dialog.mjs` where applicable.

## Federated Social

- Remote notifications go **only** through `part_invoke` (e.g. `social_on_mention`), never `char_rpc`.

## Related

- [Chat Hub AGENTS.md](../../chat/public/hub/AGENTS.md)
- [Shell AGENTS.md](../../AGENTS.md)
