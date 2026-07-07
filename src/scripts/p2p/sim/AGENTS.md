---
description: P2P tunables simulation / co-evolution harness — fidelity boundary between reused real logic and heuristic proxy environment
globs: src/scripts/p2p/sim/**
alwaysApply: false
---

# P2P Sim Harness Guide

An in-process simulation that co-evolves **tunables** (`*.tunables.json`) against an **attack genome**, scoring each candidate via `metrics.mjs`. It is a *search proxy*, **not** a wire-protocol replay. Know which side of the fidelity line you are on before touching a value.

## Fidelity boundary

- **Reused verbatim (never re-model these)** — sim imports the real decision functions, so they cannot drift:
  - Reputation: `reputation_engine.mjs`, `reputation_math.mjs`, `reputation_social_engine.mjs` (`*Pure`).
  - Trust graph: `pickTop` from `trust_graph_engine.mjs`.
  - Tunables resolve: `resolveMailboxRelayFanout` / `resolveMailboxWantFanout` / `resolveArchiveQuorumPeerMin` / `resolveArchiveQuorumPeerStrictMin` (`tunables_resolve.mjs`).
  - Admission PoW: `expectedJoinPowHashes` / `powVoluntaryBonus` (`join_pow.mjs`).
  - Tunables source: `tunables_bundle.mjs` imports the six real `*.tunables.json` — never hand-copy default values.
- **Heuristic proxy (intentional abstraction, NOT the real code path)** — `model.mjs` (`simulateMailbox` / `federationSaturatingReach`), `discovery.mjs` (`discoveryReach`), `transport.mjs` (`transportMetrics`), `integrity.mjs` (`simulateArchiveQuorum`). These approximate "parameters → defense" analytically; do not mistake them for the transport/routing implementation.

## Anti-drift rules

- **Do not hand-copy runtime constants.** RTC budget defaults are derived from `rtc_connection_budget.mjs` (`resolveRtcBudgetLimits()` + `MAX_SOURCE_SLOT_FRACTION`), not literals. `EXPLORE_MAX_PER_SOURCE` mirrors `peer_pool.mjs` but is kept local (importing `peer_pool` pulls node-storage fs into the sim hot path) — `test/fidelity.test.mjs` asserts equality to catch drift.
- **Signaling source names** (`DEFAULT_SIGNALING_SOURCES` in `transport.mjs`) must be real provider ids (`mdns` / `nostr` / `bluetooth`), matching `link_registry.mjs` registration. There is no `tracker` provider. `fidelity.test.mjs` guards this.
- If you add a new sim constant that shadows a real one, add a matching assertion in `fidelity.test.mjs` (which now covers both determinism/parallelism **and** constant fidelity).

## Determinism

- Everything is seeded via `rng.mjs` (`createRng`). `runSimulation(scenario, seed, tunables, genome)` must be pure/deterministic — `fidelity.test.mjs` asserts serial == parallel == batched snapshots byte-for-byte. Never introduce wall-clock or unseeded randomness; use `ctx.now` (virtual clock, advances 60s/round).
