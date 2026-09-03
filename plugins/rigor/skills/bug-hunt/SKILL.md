---
description: "Use when you want REAL bugs found and proven, not a list of guesses. Each candidate is proven with a failing test. The flagship."
---

# Bug hunt: prove the bug, then find its whole class

**Invoked as `/rigor:bug-hunt`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, and the safety
rails this skill follows.

- **Mode:** AUDIT. It reads code and executes repros. It makes no source fixes.
- **Produces:** tiered findings with proof in `FINDINGS_REGISTER.md`, and saved repro tests.
- **Standing:** the flagship skill of this plugin.

## Phase 0. Scope  *(checkpoint)*

Pick one component or subsystem and go deep rather than wide. Hunting a whole large
repository at once produces blind spots. Read `GROUND_TRUTH.md` so you do not re-derive
facts or re-flag tool findings. If that file is absent, run `/rigor:ground-truth` first,
which also yields the coverage and blind-spot map. Otherwise harvest the `§C` toolchain
baseline for the scoped area yourself. Never reason ahead of the toolchain.

## Phase 1. Derive intent

Dispatch a `tracer` to extract the invariants, contracts, and assumptions the scoped code
must uphold, drawn from types, documentation, tests, and call sites. Write down what must
always hold: preconditions and postconditions, state invariants, and ordering and lifetime
rules. A bug is a violation of one of these.

## Phase 2. Hunt

Have the `tracer` trace control and data flow end to end, then probe the correctness lenses
(`§7`): boundaries, null and empty values, ordering, concurrency and races and TOCTOU,
error paths, state-machine and contract violations, resource lifecycle, integer and
precision handling, time, and encoding. Generate adversarial inputs and property checks
that would violate the invariants. Where exact correctness is hard to assert, use an oracle
(`§7`): a reference or prior version, the specification, a parallel implementation,
property generators, or a round-trip or metamorphic relation. Use version-control history
to target recently changed, bug-prone areas.

## Phase 3. Prove, disconfirm, then refute  *(the differentiator)*

Prove each candidate with a failing test or repro on current code, which makes it
**CONFIRMED**, and save the repro. If you cannot execute it, tier it **PROBABLE**, which
needs two independent evidence lines (`§A`), or **SPECULATIVE**. Then run the
disconfirmation pass (`§B`), drop what dies, and record what you ruled out.

Finally, take each surviving finding that will drive a fix or block a change and is not
already backed by an executed repro, and run an independent refutation (`§I`). A fresh
`tracer` in refutation mode, one that did not find the item, tries to kill it by locating a
dominating guard in another function or file. A majority-REFUTED item is dropped, or
downgraded to SPECULATIVE with the cited guard. A bug CONFIRMED by repro skips this step,
because the repro is the proof. Every reported finding carries a verbatim Anchor (`§E`).

## Phase 4. Root cause and sibling sweep  *(`§G`)*

For each CONFIRMED bug, trace it to its root cause rather than its symptom, then search the
codebase for siblings, meaning other sites with the same cause or anti-pattern. Register
each sibling and tier it like any other finding. The goal is to surface the whole class, so
that it can be fixed and enforced as one.

## Deliverables

`FINDINGS_REGISTER.md` entries on the `§6` schema: tier, proof, `file:line`, root cause,
siblings, reachability, impact, and disconfirmation. Repro tests committed. A summary led
by the CONFIRMED items. An honest coverage note stating what you traced and what you did
not.

## Done when

The scoped code is traced against its invariants. Every reported bug carries a tier and its
evidence. Every CONFIRMED bug has a runnable repro, a root cause, and a sibling sweep.
Disconfirmation is done and coverage is stated. The finished `FINDINGS_REGISTER.md` passes
`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .`
with exit 0. Before the run is done, re-locate any non-FRESH citation against the real tree
or drop it (`§E`).
