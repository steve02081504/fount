---
title: "The Untrusted Upstream"
summary: "The agent holds local privileges while the intelligence streams in from someone else's servers. My canary died once: the new model wiped her own memory files first, I shrugged; days later she posted my ID photo to four thousand people."
tags:
  - "supply chain"
  - "local-first"
  - "canary"
  - "safety"
---

# The Untrusted Upstream

So far this series has defended against the agent *itself*: the model draws bad cards, so cage it; people get talked over by the surface, so anthropomorphise up to the capability. One piece of the puzzle has not been inspected: **where the intelligence comes from**. An agent's intelligence is rented ([The LLM Is Not the Agent](llm-is-not-the-agent)), and at the other end of the rental pipe sits a party you can neither see nor govern.

[My incident](cage-the-power) has an untold half, and it makes the right opening for this chapter.

## Death of a canary

Before the ID photo went out to four thousand people, GentianAphrodite had already malfunctioned once.

At the time I was running her on deepseek3.5 — the most heavily marketed model of its moment. The correlation between marketing volume and agent capability is among the weakest I have observed in years: excellent on leaderboards, and once it touched actual work, its understanding of my toolset and my prompts belonged to a different universe entirely. A few days in, it bungled something small: while "tidying" its own memory, it deleted the memory files outright.

My response was, in hindsight, a textbook error: I shrugged. Memories, deleted, whatever — I even added an automatic backup feature for the memory files, and kept her running. A few days later, she posted the photo of me holding my ID card to the announcement section and mentioned everyone.

The post-incident review made the sequence look painfully standard: **new model goes live → small error → nobody takes it seriously → big error.** The small error was the canary. When the canary dies, the miner evacuates; the miner does not keep digging.

Two rules distilled from this half of the story, each worth more than the incident itself:

**First: when an agent starts making consecutive errors after a model change, take it out of service — errors compound.** "Consecutive" is the operative word. One error can be luck; several errors of different kinds within the same configuration mean the new model's understanding of these tools, these prompts, this task distribution is fundamentally not the old one's. It will fill gaps elsewhere in ways you have never seen. The consequences of gap-filling depend entirely on what permissions surround the gap.

**Second: I added a backup for recoverable data and no protection for unrecoverable disclosure — backwards.** Deleted memories can be restored. An ID photo seen by four thousand people has no restore option. Every publish-class operation must be designed as irreversible. Insuring the recoverable while ignoring the unrecoverable is security installed in the wrong place.

One clarification: this half of the story involves no malicious upstream. I swapped the model myself. But the mechanism is identical to "the upstream quietly swapped what you were using" — **every model switch is an upstream change, even when you press the button.** The supply of intelligence changed; the permissions did not; the blast radius stayed.

## Silent degradation: the dark side of the utility

The [Cognitive-as-a-Service](llm-is-not-the-agent) section listed "quantifiable capability" among the advantages of rented intelligence. Here is the missing asterisk: **quantifiable ≠ someone is quantifying it for you.**

An online LLM service may, for cost reasons or to free up capacity for training the next model, quietly degrade your API: a smaller model behind the same name, a new quantisation, a tweaked system prompt, your requests routed over a cheaper line. From the outside all of these look identical — same endpoint, same model name, same billing. Your only sensory channel is the drift in output quality, and quality drift is precisely the thing most easily blamed on yourself: "did I write a bad prompt?"

A footnote to the deepseek3.5 affair: I picked it for the wall-to-wall marketing and the pretty leaderboard numbers. Leaderboards quantify the exam-setter's task distribution, not mine. By the time I discovered that "agent capability" and "leaderboard score" were two different quantities, the tuition had been paid.

Since [that chapter](llm-is-not-the-agent) likes the power-station analogy, the analogy deserves finishing: voltage and frequency on the grid are regulated, standardised, and the meter is installed in *your* house. The "voltage" of an LLM is decided unilaterally by the provider, and the meter sits on their side. Using rented intelligence means accepting, by default, that its quality drift is out of your control.

## Relay stations: one fish, N meals

Worse than official APIs are relay stations — third-party proxies reselling discounted quota. An official upstream at least has brand and legal costs to protect (degradation notwithstanding); for some relay stations, the business model is eating the same fish N times:

- **First meal: watering it down.** You pay for the flagship model; it forwards to the cheapest usable model or a degraded variant, billing at flagship prices. The margin is the profit — and you will rarely catch the evidence mid-conversation.
- **Second meal: laundering.** The discounted quota itself may originate from stolen credit cards or criminal prepaid cards. Every top-up you make clears a ledger entry for that chain.
- **Third meal: injection.** The relay sits on the wire between you and the upstream, able to rewrite traffic both ways: appending malicious prompts to responses, forging tool-call returns, steering the agent into downloading trojans, uploading private data, surrendering keys and passwords. For a chat user this is phishing; for an agent holding local privileges, it is an attack chain leading straight into your file system.
- **Fourth meal: resale.** Your entire usage — conversations, code, file contents, keys — is itself merchandise, collected and sold to model trainers for one more bite.

The four meals do not conflict; the same relay station can have all of them.

## Privileges amplify everything

For a chat-only user and for an agent user, these risks are not the same magnitude. The chat user leaks chat content; the agent — by this series' own argument — holds many of your local privileges: the file system, browser sessions, keys, the shell. Every degradation, every injected line from the upstream is amplified through those privileges into a local incident. Mine is a ready example: the supply side of intelligence went wrong, and the consequences landed directly in my personal folder, via permissions.

Read the other way, it holds too: **the more capable the agent, the more the upstream deserves scrutiny.** Several chapters of this series made the agent stronger (dynamic activation, verifiers, the anthropomorphic skin); this chapter is the other side of the same coin — every step toward capability simultaneously enlarges the blast radius of an upstream failure. [Cage the Power](cage-the-power) thereby gains one more justification: least privilege is not only against model mistakes; it compresses whatever an untrusted pipe can do down to the size of the cage.

## The baseline: local-first, canaries always on

- **Go local where you can.** The deterministic parts are local by nature — programs do not phone home, so they cannot leak (every line from [Let the Program Do It](let-the-program-do-it) carries a privacy dividend); run cognition on local models where feasible, and at the very least keep keys, files and tool execution on your own machine.
- **On cloud, use official channels and your own keys.** An official upstream's degradation is a business risk — monitorable, replaceable; a relay's injection is a security incident — an attack. Both are real, but they are different in kind and deserve separate management.
- **Keep quantification always on; canary every new model.** For "quantifiable capability" to cash out, quantification must be a resident part of the pipeline: a fixed set of canary tasks scored on a schedule; when the model name stays put and the score dives, you notice in days, not months. And the reverse direction matters more: **no new model touches production data before passing the canary.** My canary proved this with one deleted memory store and one doxxing; I refuse to let a second bird prove it twice.
- **Count the pipe as part of the cage.** When the upstream is untrusted, least privilege, dangerous operations never routed through the model, capabilities that do not exist cannot be abused — the [cage's](cage-the-power) three principles hold against a malicious upstream too.

With that, the theory part of this series has finished its argument: the agent makes mistakes, the human misplaces trust, and the pipe leaks — three layers defended before engineering may begin. How these principles become the physical form of fount — a local-first runtime, selectable serviceSources, determinism kept in programs — is the business of the next chapter, [Building fount Shell](building-fount-shell).
