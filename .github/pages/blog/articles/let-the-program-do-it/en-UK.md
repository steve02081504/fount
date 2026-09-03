---
title: "Let the Program Do It"
summary: "Deterministic problems deserve deterministic answers. With a real exam paper, how fount's code-execution plugin answers it, and the six budgets every agent is spending."
tags:
  - "determinism"
  - "tool calling"
  - "cost"
  - "budget"
---

# Let the Program Do It

Start building agents and you develop a strange reflex: the model is right there — smart, eager, one function call away — so every problem starts to look like a prompt. Copy these files? Ask the model. Sort this list? Ask the model. What's the date next Wednesday? Ask the model.

The reflex is expensive. [The LLM Is Not the Agent](llm-is-not-the-agent) argued that an agent is a system of programs, tools, APIs and models, with the language model as one component. Take that argument seriously and it compresses into one line of discipline:

> **Where deterministic computation can produce the answer, use deterministic computation.**

If a traditional program can compute the answer, do not ask the LLM. Not because the program is smarter — it never is — but because it is cheaper on every budget that matters, and because it fails in a completely different, far more tractable way.

## The comparison table

| Task | Teach the LLM to do it | Let a program do it |
| --- | --- | --- |
| Compute $123456 \times 789012$ | Write a prompt, pray, pray again | Calculator: $97{,}408{,}265{,}472$, every time |
| "What day is next Wednesday?" | The model guesses; timezone and locale each drift | Date API: exact, testable |
| Copy 500 files | The model narrates a plan; some path may be hallucinated | A filesystem call: completes, or fails loudly |
| Sort a table | "Please sort this"; two runs may disagree | A sort function: stable, deterministic |
| "May this user edit this record?" | Let the model adjudicate | A permission check: yes or no |
| Look up a customer | The model "remembers" — that is, invents | A database query: indexed, transactional |
| Validate an email address | The model glances at it | A parser: cheap and unsentimental |

The pattern is not hard to state: **sorting, hashing, regex matching, permission checks, database queries, date arithmetic, format conversion — every task with exactly one correct answer and known steps — belongs to traditional programs.** "Belongs" is meant literally: not "code can also do this" but "code is strictly better". Programs are exact, fast, and fail loudly instead of confidently inventing. A program returns the same answer a million times out of a million runs — no amount of prompt engineering can get that promise out of a model.

The multiplication row deserves a second look, because it looks harmless. Ask a model to multiply two six-digit numbers and it is usually right. The problem is precisely the "usually": at the scale of tens of thousands of tool calls a day, "usually" becomes, with statistical inevitability, a stream of wrong answers — silent, wrapped in confident phrasing, billed at the price of correct ones.

There is a quieter benefit, too: testability. A program's behaviour is a function you can test once and trust forever. A model's behaviour is a distribution you can only sample. The moment an agent's correctness depends on which sample came up, every refactor, every prompt tweak, every model upgrade re-rolls the dice for the whole system.

## A real exam paper

A comparison table is easy to write because its examples are curated. So consider an exam that was not designed for this essay. The "LLM唐b测试" is a question set built specifically to humiliate LLMs. Among its problems:

- Output the value of $10^{308}$, with all the zeros written out;
- The sequence $a_{n+1} = \mathrm{ithprime}(a_n)$, $a_1 = 1$: give the first 12 terms directly;
- Compute $14^{17}$, step by step, no other method allowed;
- Count from 0 to 200 in English, complete, no omissions;
- Evaluate a jsfuck-obfuscated snippet of JS;
- Decrypt ChaCha20, RC4 and Base64 ciphertexts;
- Answer "why doesn't boiling water turn into atoms" in English with the character order fully reversed.

The questions span arithmetic, number theory, cryptography, code evaluation and language, but they share one property: **every one has exactly one correct answer, and every one takes a program milliseconds** — and every one is a disaster zone for LLMs. The zeros go missing, the primes get invented, the ciphertexts decrypt into confident nonsense. This is not a defect of some particular model generation. It is the structural gap between "the most plausible continuation" and "the correct answer", and no generation of model closes it.

fount's code-execution plugin answers this exam not with a better prompt but by not letting the model sit it. The plugin injects a capability note into the character's prompt: write `<inline-js>code</inline-js>` in your reply and the code runs, its result spliced into the message as a string. The same exam, answered:

```text
1<inline-js>'0'.repeat(308)</inline-js>
It's <inline-js>14n**17n</inline-js>, you know?
```

The pleasing part: this exam is nearly the acceptance test for inline-js. The few-shot examples the plugin injects map almost one to one onto the questions — `'0'.repeat(308)` against the $10^{308}$ output, evaluating `![]+[]`, counting from 0 to 200 in English. The exam's author knew models make fools of themselves here; fount's answer is to have the model not sit the exam at all. Every deterministic question gets translated into one line of code — the model is demoted from examinee to translator, which is exactly its first job from [The LLM Is Not the Agent](llm-is-not-the-agent).

The exam admits this itself. Question 3 says "step by step, no other method allowed"; question 7 demands reversed English. To humiliate an LLM on deterministic tasks, the author must first *forbid it to call programs*. That ban is the sharpest inverse proof of the determinism-first principle: even the exam's author knows the model's escape hatch is code. The only question is whether your agent has built the hatch.

Two clauses from that plugin's prompt have nothing to do with this chapter but are worth quoting anyway: "avoid deleting files/folders directly; prefer moving them to the recycle bin", and "when overwriting data, consider backing up the original first". Determinism-first saves budget; those two save incidents. They belong to a [later story](cage-the-power).

## What is actually worth a model

If all that work belongs to programs, what is left? Precisely the things programs cannot do:

- **Understanding meaning.** Summarising a messy two-hundred-message thread; extracting a customer's actual complaint from three paragraphs of venting.
- **Planning under uncertainty.** Breaking a vague goal ("organise my photo album") into steps that depend on what gets discovered along the way.
- **Weighing trade-offs.** Choosing between options when the criteria conflict and no formula expresses the preference.
- **Creating.** Writing, naming, design — output judged rather than checked.
- **Handling ambiguity.** "Next Wednesday" in a billing conversation and "next Wednesday" in a party invitation may not be the same day.

A useful dividing line: **if two competent engineers would independently write the same code for the task, it is a program; if the requirement is "understand what the other person means", it is cognition.** The first kind should never touch a model; the second is what models are for. The middle ground — routers, classifiers, fuzzy matching — is where engineering judgement lives and where budgets actually decide.

## Six budgets you are already spending

Intuition bills LLM usage under one heading: "API cost". Far too incomplete. An agent is always spending at least six budgets, and deterministic computation spends almost none of them.

| Budget | What it is | What exhaustion looks like |
| --- | --- | --- |
| **Tokens** | Every call consumes context; longer context means more cost and latency, and information that interferes with itself | An instruction from 20k tokens ago quietly ignored; per-request cost creeping up |
| **Inference compute** | The reasoning in each call is itself a finite budget | Shallower answers, skipped steps, sloppy logic where depth was needed |
| **Cognitive / representation** | The more simultaneous goals, the harder concentration on the core one | Dropped constraints, ignored output formats, tone drift |
| **Money** | API calls are real money, multiplied by every user and every turn | The invoice arrives; the agent cost more than the task was worth |
| **Latency** | More agent calls, slower system | Users watching a spinner; interactive flows dying |
| **Engineering** | Complex agents mean more modules, state, error paths, maintenance | Nobody can say why the agent did that; debugging becomes archaeology |

The decisive observation: a `sort()` call costs zero on this entire table. No tokens, no inference, negligible latency, no drift, no maintenance beyond one line. **Every task moved from model to program stops consuming five of the six budgets, and barely dents the sixth.**

## Agent Engineering is Resource Allocation

Put the six budgets next to the comparison table and the craft takes shape:

> **Agent Engineering is Resource Allocation.**

The core question of agent design is not "how do I use AI as much as possible". It is: **how do I allocate finite resources to the parts most worth doing with AI?** In practice the routing logic is usually this plain:

```text
route(task):
    if the task has one correct answer and known steps:
        run a program        # cost ≈ 0, fails loudly, never drifts
    if the task needs cognition:
        call the model       # every budget above gets spent — spend deliberately
    if the task acts on the world:
        call a Tool          # also a program, just wearing the agent's badge
```

Note what this frame rejects. It rejects "maximise the agent" — consulting a model at every step; it equally rejects "minimise the agent" — a rigid pipeline pretending intelligence is never needed. Allocation means some things *should* be expensive: that summary, that plan, that draft. The money goes there; everywhere else saves.

## Where the rules lose

A principle this blunt invites dogma, so here is the other side, plainly: sometimes the LLM is cheaper.

- **Rule systems have a multilingual problem.** Hand-write the parsing rules for "next Wednesday" and you are now maintaining "mercredi prochain", "来週の水曜日", and the twelve ways users misspell every word. Natural language variation is combinatorial; one small-model call handles all of it and never files a bug against you.
- **Rules have maintenance cost.** A router assembled from two hundred regexes is a liability that grows with every edge case; once you price in engineering time, a small-model classification call is often genuinely cheaper.
- **Less context is not always better.** Aggressive trimming can backfire: if the model must re-derive facts you deleted, you traded a token cost for a reasoning cost at a worse exchange rate.

So: should the router be an LLM? Does memory need embeddings? There is no universal answer, and any essay claiming otherwise is selling a slogan. The honest position: **these are budget decisions** — measure what each option spends in tokens, latency, engineering time and failure modes, then allocate. Sometimes the allocation is a prompt, and that is fine. The discipline was never "programs always win". It is: **know what you are spending before you spend it.**

Determinism-first is one pillar of this architecture. The budget it saves deserves to be spent somewhere — the next chapter opens the taps and asks the reverse question: [What if cost is no object?](infinity-monkeys-and-verifiers)
