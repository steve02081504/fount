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

## Replica husk / join catch-up

- Disk shape `groups/{id}/signers/` only (no `events.jsonl`) is a crash or half-deleted husk — **not** a healthy “waiting for network” state. `ensureGroup` must not mint a second genesis under the same id (reuses old seed → identity poison). Delete the husk or re-join with invite.
- Invite `roomSecret` lives in `federation_bootstrap.json` (+ memory cache) until DAG gains `roomSecret`. `performMemberJoin` always ends in bind+catch-up — already-a-member only skips appending another `member_join`.
- Catch-up with `federationActive:true` + `tipsCollected:0` means you are alone in the signaling room — wait for a peer (both sides open the group), not a missing local DAG writer. `federationActive:false` means no usable `roomSecret` (bootstrap missing and DAG has none).
