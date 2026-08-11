# Docs Writing Guide (Design / Review / Issues / Agent docs)

For maintainers of `docs/design/`, `docs/review/`, `docs/issues/`, and every `AGENTS.md`.

| Directory | Purpose |
| --- | --- |
| `docs/design/` | Baselines, specs, unscheduled directions |
| `docs/review/` | Gap analysis vs current state; code and tests are ground truth — do not re-describe landed work as long prose |
| `docs/issues/` | Standing conclusions for open / blocked GitHub issues (ours or upstream) — status, don't-dos, what to change when unblocked. Not day-to-day agent reading |
| `AGENTS.md` (+ linked `docs/*.md`) | Day-to-day agent guidance only |

**`AGENTS.md` content policy**: keep important conclusions, guidelines, and tool introductions. Important but uncommon → new file under a nearby `docs/` + one-line link from `AGENTS.md`. Research narratives, investigation diaries, and one-off task-specific notes → delete (do not archive).

**Language**: `docs/design/`, `docs/review/`, and `docs/issues/` are **human-facing Chinese** (keep Chinese). Every `AGENTS.md` and non-`AGENTS.md` file in its link closure stay **English** — enforced by `fount test checks:agents_md_english` (`docs/design|review|issues` exempt from CJK). Non-`AGENTS.md` files in that closure must live under a directory named `docs`.

Milestone codes (`M1` / `G4` etc.) are fine in design/review while a batch is open; **never** leak them into source / test names / `llms.txt` (see root `AGENTS.md`).

## What every gap entry must state

1. **User-visible impact**: which action breaks under normal usage. If you cannot state this, it does not belong in the summary list.
2. **Main path vs edge**: default reader model is **one person, one fount, agent and owner on the same machine**. Multi-node / owner-host-separated cases are **edge / no daily impact** — demote them.
3. **"Not this"**: one or two sentences blocking common misreads.
4. **Evidence**: code paths or integration test names. Summary layer uses plain language; tables/appendices hold technical detail.

Keep icons (✗ / △ / partial). Partial items with no daily impact → "partial (edge)" or a sub-section — not "N remaining gaps" headlines.

## Anti-patterns

- Jargon without a user-visible consequence.
- Unweighted feature-museum lists in the conclusion — edge debt gets one line + link to detail.
- Framing in-process API limits or multi-node edges as core product failures.

Domain-specific misreads: [human-agent-operational-parity-review.md](./review/human-agent-operational-parity-review.md). Related: [root AGENTS.md](../AGENTS.md); [chat-social-cabinet-tech-stack.md](./review/chat-social-cabinet-tech-stack.md).
