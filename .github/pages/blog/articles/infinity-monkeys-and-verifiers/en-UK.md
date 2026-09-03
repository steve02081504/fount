---
title: "What If Cost Is No Object?"
summary: "This series has been teaching agents to save money; this chapter spends it. The infinite monkey theorem, gacha-style generation, verifiers — and why even taste can be measured."
tags:
  - "infinite monkeys"
  - "verifiers"
  - "sampling"
  - "quantification"
---

# What If Cost Is No Object?

So far this series has been teaching agents thrift: don't ask the model what a program can compute ([Let the Program Do It](let-the-program-do-it)), don't hoard what can be activated ([Don't Put Everything in the Context](dont-put-everything-in-the-context)), budget the persona carefully. With the thrift lectures done, it is worth turning the question around: **what if cost is no object?** Open the budget — what can an agent do that it normally can't?

The answer is more radical than expected, and the key is a theorem that sounds like a joke.

## What the infinite monkey theorem actually says

The infinite monkey theorem: let infinite monkeys hammer keyboards at random for infinite time, and one of them will produce the complete works of Shakespeare. It is usually read as a parable about how nearly impossible order from randomness is — the monkeys produce almost pure garbage, and the masterpiece is a fluke on a cosmic scale.

Engineering reads it the other way round. The theorem's real component is not the monkeys. It is the **selection**: garbage in overwhelming majority is fine, as long as some mechanism can recognise the masterpiece — then all the other garbage is free. Random process × massive attempts × one reliable selector = any given finished work. The monkeys handle volume; the selector turns statistics into quality.

## The LLM is a gacha machine

Swap the monkeys for an LLM. Every generation is a draw from the model's output distribution: ask the same question ten times, get ten different answers — mostly unremarkable, occasionally brilliant, occasionally disastrous. The difference between a strong model and a weak one is, at bottom, the difference between two gacha pools: the strong model rolls gold a little more often. But no model's gold rate is one hundred percent — **generation is always a sample**.

This view immediately yields a strategy so crude it borders on shameless: draw the same question a hundred times (engineering calls it best-of-N sampling). Intuitively that is waste — a garbage model drawn a hundred times yields a hundred pieces of garbage. But what if nobody has to read them?

(Note that this does not clash with determinism-first: what can be computed still goes to programs; gacha happens only where cognition is genuinely needed.)

## Verifiers: turning statistics into a machine

Now the protagonist enters. There exists a class of things holding an asymmetric power: **verifying an answer is far cheaper than generating it**.

- Is this code correct? Run the tests: milliseconds, zero ambiguity.
- Does this chain of reasoning hold? Have a model re-check it step by step, at a fraction of generation cost.
- Is this proof valid? A proof assistant gives a mechanical verdict.
- Compilers, type checks, assertions, schema validation — the program world is full of off-the-shelf judges.

Collectively: **verifiers**. The cost gap between generating and verifying is the fulcrum of the whole strategy:

> Attach a verifier behind the gacha, and a fixed statistical outlay turns into a machine that produces content beyond the model's own level.

A weak model's budget, purchasing a strong model's output: draw a hundred times, verify a hundred times, ship the gold card. "The model's ceiling" stops being the system's ceiling — the system's ceiling = the model's ceiling × budget × verifier reliability, and the latter two are engineering variables, not model variables. This is the engineering reading of the infinite monkey theorem: the monkeys need not be clever; the selector must be reliable.

But the machine's dependence on its verifier is absolute. Without one, a hundred samples are a hundred drafts for a human to read — the selector is you, and the budget's spending degenerates from "machine" back to "manual labour". And where no verifier can cover the task, drawing more just costs more — budget cannot buy what the distribution does not contain.

Verifiers have their own ladder: program assertions cheapest, model review in the middle, humans most expensive. Same old rule as [that ladder](dont-put-everything-in-the-context#the-routing-ladder): cheap methods first.

## And what about beauty? Can that be quantified?

Here comes the instinctive objection: code passes tests and proofs pass checkers, but agents also produce **aesthetic** output — a piece of copy, the voice of a roleplayed character, the feel of an interface. There are no unit tests for those.

The answer: a verifier need not be a program. It needs to be a **repeatable selection procedure**. And for building one, there is a recipe that has never once failed: metricise first, then A/B test.

- **Metricise**: break "good" into observable proxies — completion rate, rework count, reviewer scores, style consistency, adoption rate. A metric is never the beauty itself; it is a handle the selector can grip.
- **A/B test**: give two versions to real users at random, and let preference vote. This is the human verifier: slow, expensive, but adjudicating the actual question — which one do people prefer.

This is the surveying tool for the open question [the roleplay chapter](does-roleplay-make-llms-worse) left behind — the functional/biographical split is a sketch, the border has no map. When the persona is data rather than architecture, swapping a persona is swapping an experimental group: the border can be measured an inch at a time.

So "nothing cannot be quantified" should be read honestly: it does not claim beauty has a formula. It claims **preference can be measured and selection can be automated**. Quantification does not answer "what is beautiful"; it answers "which is better" — and engineering only ever needed the second question.

## The price of the machine

The sampling × verifier machine has a hidden premise: **a wrong card must be harmless**. Draw a hundred answers and the worst case is wasted budget. But if every draw holds the authority of delivery — the permission to read the photo of you holding your ID, the permission to post to social media — then one wrong draw in a hundred wastes more than budget.

The infinite monkey theorem has two faces. Front: massive attempts eventually hit success. Back: **a non-zero probability, multiplied by enough attempts, equals inevitability**. The next chapter takes the back face — and it is not a thought experiment. I paid the tuition myself.
