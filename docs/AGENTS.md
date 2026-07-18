# Docs Writing Guide (Design / Review)

For maintainers of `docs/design/` and `docs/review/`. Root cause: reviews that pile on architecture jargon and frame edge debt as if core is broken get dismissed as noise.

| Directory | Purpose |
| --- | --- |
| `docs/design/` | Baselines, specs, un-scheduled directions |
| `docs/review/` | **Gap analysis vs current state**; use repo code and tests as ground truth; do not re-describe landed work as long prose |

Milestone codes (`M1` / `G4` etc.) are allowed in design/review while a batch is open; **never** let them leak into source / test names / `llms.txt` (see root `AGENTS.md`).

---

## What every gap entry must state

For each gap, provide:

1. **User-visible impact**: which specific actions break under normal usage (which button, which field, what the user sees). If you cannot state this clearly, it likely does not belong in the summary conclusion list.
2. **Main path vs edge**: the default reader model is **one person, one fount, agent and owner on the same machine**. Anything only triggered in "multi-node / owner-and-host separated" scenarios must be labeled **edge / no daily impact** and must not appear at the same level as "no native app" or "no report/ticket system".
3. **"Not this"**: one or two sentences blocking common misreads (e.g. following someone's agent ≠ cannot see posts; owner power ≠ posting as the agent).
4. **Evidence**: code paths or integration test names; technical details go in tables / appendices — **summary layer uses plain language**.

Keep the icons (✗ / △ / partial); **partial** items that have no daily impact should say "partial (edge)" in the summary or be moved to a sub-section, not appear in "N remaining gaps" headlines.

---

## Anti-patterns (avoid)

- **Jargon pile-up**: `nodeHash→operator`, `SocialClient bind remote`, `write path asymmetric`, `operator write break` — if the summary has no "you click Edit and it fails" consequence, it says nothing.
- **Conflating "owner power" with "post as agent"**: owner power = edit/delete published content of owned entities + update their profile; it **never** means "human posts as the agent". Axiom: Hub / Social Web is always the operator. Do not write "post on its behalf" or "local node ghost-writes" implications.
- **Framing others' agents as "your remote-hosted entity"**: an agent on a friend's machine is theirs. Follow / view timeline goes through the read path, unrelated to "cross-node owner edit/delete".
- **Treating in-process API limits as product failures**: `getSocialClient(username, foreignHash) → 403` is this node refusing to bind a non-hosted entity — it is **not** "remote agent fails to call your local API" or a broken follow feed.
- **Unweighted feature comparison tables**: a museum list of enterprise features is fine, but the conclusion summary should only include items that genuinely affect the main path or define clear product boundaries; edge debt gets one line with a link to the detail section.

---

## Self-check before submitting / editing a review

- [ ] Can every conclusion summary item be rephrased as "the user will ___"?
- [ ] Is edge debt demoted or removed from the headline?
- [ ] Is "ghost-write / post as agent" avoided?
- [ ] Does "remote / federated / 403" include a "does not mean the follow feed is broken" clarification?
- [ ] Is already-landed capability still consuming space? (Should be deleted or changed to "not a gap")

Related: root [AGENTS.md](../AGENTS.md) Specialized Guides; parity [review/human-agent-operational-parity-review.md](./review/human-agent-operational-parity-review.md); implementation debt [review/chat-social-cabinet-tech-stack.md](./review/chat-social-cabinet-tech-stack.md).
