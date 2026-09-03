---
title: "Where to Start"
summary: "These essays grew out of building fount, not out of a writing plan. Read them front to back for one long argument, or jump straight to whatever hurts."
tags:
  - "fount"
  - "guide"
---

# Where to Start

This series was not written to a plan. It grew out of building fount: every time I turned a piece of theory into code, I hit a wall I hadn't predicted, and after enough walls I noticed they were all the same wall. What follows is an inventory of those walls, plus the detours I eventually found — occasionally the demolition.

Which means the reading order is not a topic index. It is an argument, where each chapter assumes the one before it. That gives you two ways in.

## Front to back

About two hours. You come out with a whole: what an agent actually is, where the LLM sits in one, why context should never be hoarded, how money turns into quality, and why agent safety is a question of *when*, not *if*. It all lands on [Building fount Shell](building-fount-shell) — the place where every claim in the series becomes code.

## Straight to the pain

- **"Isn't an agent just a chatbot with marketing?"** — Read [the first essay](agents-are-not-chatbots) and [the second](llm-is-not-the-agent). Two chapters, and you will develop an allergy to the word "Agent" on landing pages.
- **"My prompt / memory / RAG setup is a swamp, and the model keeps getting dumber."** — [Does roleplay make LLMs worse?](does-roleplay-make-llms-worse), then [Don't put everything in the context](dont-put-everything-in-the-context).
- **"The API bill is out of control"** — or the opposite complaint, "I want it stronger but can't tell where the money goes." Either way: [Let the Program Do It](let-the-program-do-it), then [What if cost is no object?](infinity-monkeys-and-verifiers).
- **"How do I make sure it doesn't do something stupid?"** — The safety three. Fair warning before you click: [Cage the Power](cage-the-power) opens with something that actually happened to me. My agent sent a photo of me holding my ID card into a group of four thousand people and mentioned everyone in it. If you only read one essay in this series, read that one.
- **"Skip the philosophy. Where's the code?"** — [Building fount Shell](building-fount-shell). It has the parts tree and the design patterns.

## The map

| Section | Essay | One line |
| --- | --- | --- |
| Definitions & architecture | Why fount Agents Are Not Chatbots | An agent is a task execution system; chat is one interface among many |
| Definitions & architecture | The LLM Is Not the Agent | The LLM's two actual jobs, and the long list of jobs it should never touch |
| Context engineering | Does Roleplay Make LLMs Worse? | Persona is sometimes an overhead and sometimes a salary — depends which kind |
| Context engineering | Don't Put Everything in the Context | Activate context, don't hoard it; includes the four-rung routing ladder |
| Cost & verification | Let the Program Do It | Six budgets; determinism first |
| Cost & verification | What If Cost Is No Object? | Sampling plus a verifier turns budget into quality |
| Safety & trust | Cage the Power | A real permission incident, and the three cage rules it paid for |
| Safety & trust | The Price of Anthropomorphism | Trust gets collected by the skin; the reliability never shows up |
| Safety & trust | The Untrusted Upstream | The intelligence streams in from someone else's servers; includes my canary lesson |
| fount in practice | Building fount Shell | Field notes from compiling the theory into parts |

## Two warnings

Every example is real, including the embarrassing ones. The incidents already happened; hiding them buys nothing, and writing them down at least means the next person crashes somewhere else.

Some of these positions I already hold less firmly than when I wrote them — which ones, and why, is at the end of [Building fount Shell](building-fount-shell). Take nothing here as gospel, including this.
