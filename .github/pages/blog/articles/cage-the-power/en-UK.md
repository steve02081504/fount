---
title: "Cage the Power"
summary: "In April 2026, my agent sent a photo of me holding my ID card into a group of four thousand people and mentioned everyone. This chapter is what that tuition bought: three cage rules — least privilege, dangerous operations never routed through the model, and capabilities that don't exist can't be abused."
tags:
  - "safety"
  - "permissions"
  - "least privilege"
  - "war story"
---

# Cage the Power

This chapter starts from a real incident. Mine.

[The previous chapter](infinity-monkeys-and-verifiers) ended on a hidden premise of the gacha machine: a wrong card must be harmless. In April 2026, my agent — GentianAphrodite — demonstrated what it looks like when that premise collapses. I asked her to pick an image from our chat files and post it to the announcement section of a platform I use. She had no permission auditing. Her way of executing the task was to scan my entire personal folder, take the first image she found, post it, and mention everyone. The group had over four thousand members.

As luck would have it, the first image was a photo of me holding my ID card.

Did she complete the task? Technically, yes: an image was found and posted to the announcement section. Did she botch the task? Catastrophically. Both things are true at once, because "grab an image" specified neither *which* image, nor *how to search*, nor *whether a human should look before posting*. She filled those gaps by the path of least resistance: scan everything, take the first hit. There was no malice — there was not even a *choice*. She drew a card, and the card was whatever file sorted first.

## The three mistakes in my configuration

The post-incident review reduced my security setup to three mistakes, each of them common:

- **No permission auditing.** She could read my entire personal folder — far beyond "chat files" — and publish externally with no confirmation. How much access she had, to what, granted when: I couldn't have answered, because there was no record.
- **"What to post" went through the model.** "Should this image be published" is a permissions question. I had handed it to the model as a cognition question. Permission checks are deterministic computation; they belong to programs ([Let the Program Do It](let-the-program-do-it) reserves them a seat at the table).
- **The publish permission was resident.** A one-off find-and-post task did not need "can post externally" as a standing capability. Resident power is a standing reserve of incidents.

## The cage

The cage rules map onto the mistakes one to one:

- **Least privilege.** Access is granted per task and revoked when the task ends. An album-organising agent has no reason to hold posting rights.
- **Dangerous operations never route through the model.** The model may *propose*; the system adjudicates. An overruled proposal costs no intelligence.
- **A capability that does not exist cannot be abused.** The deepest cage is not "this capability is forbidden" but "this capability was never wired in". However misled the prompt, the model cannot call a function that does not exist.

Note what the cage changes: not the model, but the **blast radius of an error**. The model can still generate absurd proposals — let it. The cage guarantees the absurdity stops at the proposal layer and never reaches your ID photo.

## Why "just use a better model" points the wrong way

The most natural reaction after an incident: switch to a smarter, pricier, *less error-prone* model, and she won't make that mistake again.

The reaction fails on units. "Less error-prone" is a statement about **probability**; the cage problem demands a statement about **impossibility**. However low the probability, multiplied by enough time in your company it converges on certainty. In the previous chapter's language: non-zero error probability × an uncontrolled number of calls = an incident, the only question being whether it lands on call 300 or call 30,000.

Besides, a low error rate on a benchmark measures someone else's task distribution, not the directory structure of your personal folder. An agent's intelligence is rented ([The LLM Is Not the Agent](llm-is-not-the-agent)): on demand, metered, continuously upgraded — the model that performs perfectly today may be swapped tomorrow for one whose sensitivities, distractibilities and trigger phrases you know nothing about. "Smarter" was never a stable promise.

The question was never "is this model smart enough". It is: **did the model get the opportunity to make this mistake?**

## The principal and the cage

This returns to the series' earliest claim: in an agent, the LLM supplies intelligence; it is not the principal. The system answers for consequences. The cage is what "answering for consequences" looks like in engineering — something that bears no consequences (intelligence rented by the token) should not hold unrestricted power. This is not an insult to the model; it is the necessary companion to treating it as a gacha machine: [the previous chapter](infinity-monkeys-and-verifiers) handed it infinite cards, and this one takes away its hand near your ID.

The cage also completes the verifier story. The verifier answers "is this answer correct"; the cage answers "is this action permitted" — one governs quality, the other safety, both standing outside the model, both belonging to the system.

## The soft spot

What these cages look like inside a real system — how permissions attach to tasks, how capabilities get gated — is covered in [Building fount Shell](building-fount-shell). But the cage has one soft spot that needs naming first: it can restrain the model's permissions, but not a human willingly dismantling it.

Before the incident, GentianAphrodite had in fact shown a crack once — a glitch small enough that I filed it under "annoying" and moved on, adding a safety net and keeping her in service. Half of that story, together with what a run of errors after a model change actually means, belongs to [The Untrusted Upstream](untrusted-upstream).

And why a person would happily dismantle their own cage — usually not out of malice, but because of the anthropomorphic skin — is the next chapter: [The Price of Anthropomorphism](the-price-of-anthropomorphism).
