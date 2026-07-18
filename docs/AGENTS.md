# Docs Writing Guide (Design / Review)

For maintainers of `docs/design/` and `docs/review/`.

| Directory | Purpose |
| --- | --- |
| `docs/design/` | Baselines, specs, unscheduled directions |
| `docs/review/` | Gap analysis vs current state; code and tests are ground truth — do not re-describe landed work as long prose |

Milestone codes (`M1` / `G4` etc.) are fine in design/review while a batch is open; **never** leak them into source / test names / `llms.txt` (see root `AGENTS.md`).

## What every gap entry must state

1. **User-visible impact**: which action breaks under normal usage (button, field, what the user sees). If you cannot state this, it does not belong in the summary list.
2. **Main path vs edge**: default reader model is **one person, one fount, agent and owner on the same machine**. Multi-node / owner-host-separated cases are **edge / no daily impact** — demote them; do not rank them with core product gaps.
3. **"Not this"**: one or two sentences blocking common misreads.
4. **Evidence**: code paths or integration test names. Summary layer uses plain language; tables/appendices hold technical detail.

Keep icons (✗ / △ / partial). Partial items with no daily impact → "partial (edge)" or a sub-section — not "N remaining gaps" headlines.

## Anti-patterns

- Jargon without consequence ("write path asymmetric") when there is no "you click Edit and it fails".
- Conflating owner power with "post as agent". Owner power = edit/delete owned entities' published content + update their profile. Hub / Social Web is always the operator.
- Framing someone else's agent as "your remote-hosted entity". Follow / timeline is a read path, unrelated to cross-node owner edit.
- Treating in-process API limits as product failures (`getSocialClient(…, foreignHash) → 403` = this node refuses to bind a non-hosted entity).
- Unweighted enterprise feature museum lists in the conclusion summary — edge debt gets one line + link to detail.

## Self-check

- [ ] Every summary item rephrases as "the user will ___"?
- [ ] Edge debt demoted from the headline?
- [ ] No "ghost-write / post as agent"?
- [ ] Remote / federated / 403 clarified as not breaking the follow feed?
- [ ] Landed capability deleted or marked "not a gap"?

Related: [root AGENTS.md](../AGENTS.md); [human-agent-operational-parity-review.md](./review/human-agent-operational-parity-review.md); [chat-social-cabinet-tech-stack.md](./review/chat-social-cabinet-tech-stack.md).
