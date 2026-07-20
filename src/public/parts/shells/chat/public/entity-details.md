# Entity model details (less common)

Day-to-day rules: [AGENTS.md](AGENTS.md).

## `member_join` binding

`bindingSig` + `verifyEntityActivePubKeyBelongs` — cannot spoof another entityHash with a self-made active key. Ownership proof order: this replica's identity → any same-process hosted identity (`findLocalEntityActivePubKey`) → EVFS `profile.json`.

## Agent-only groups

`createInvite` → `activateGroupFederation` must include `entityHash`, or `group_settings_update` is rejected (`requires active member sender`).

## Avatars

`shared/hashAvatar.mjs` + `entityAvatar.mjs` + Hub `avatarCover.mjs`. Empty → hash letter. Part `info.avatar` syncs via `syncAgentProfileFromCharPart`. `/parts/<part>/…` avatar URLs map to that part's `public/`. Backfill missing on ensure; do not overwrite existing.

## Load reentrancy

Char `Load` → `ensureLocalAgentEntityHash` → `syncAgentProfileFromCharPart` must not `loadPart` the same char. Prefer `part.info` over re-running `UpdateInfo`.
