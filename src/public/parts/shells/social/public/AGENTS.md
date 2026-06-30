# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Timeline ingress at `src/timeline/sync.mjs` (`ingestRemoteTimelineEvent`); social RPC ingress at `src/discovery.mjs` (`handleSocialRpc`); outbound filtering on federation pull in `src/timeline/federationExport.mjs`.
- **Follow list**: no sidecar JSON; `following` is materialized from the operator timeline (**implicit self-follow**); reverse lookups use `{dataPath}/p2p/node/social/follower_index/buckets/{hexPrefix}.json` bucketed projection (LRU hot cache).
- **Personal block/hide** (per entity, Chat + Social shared): public `block`/`unblock` timeline events → `personal_block.json` index + reputation propagation; private `hide` → `personal_hide.json` only. **Group kick/ban** remains `blocklist.json` group scope + DAG governance (separate).
- **Reputation consumption**: feed/search/trending filter or demote authors by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` (`public/src/templates/`) over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs` where applicable.

## Federated Social

- Remote notifications go **only** through `part_invoke` (e.g. `social_on_mention`), never `char_rpc`.

## Related

- [Chat Hub AGENTS.md](../../chat/public/hub/AGENTS.md)
- [Shell AGENTS.md](../../AGENTS.md)
