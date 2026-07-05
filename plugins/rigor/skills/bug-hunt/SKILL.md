---
description: "Use when you want REAL bugs found and proven, not a list of guesses: derives invariants, traces flow, proves each candidate with a failing test, then root-causes and sweeps for siblings. The flagship."
disable-model-invocation: true
---

# BUG HUNT — Prove the Bug, Then Find Its Whole Class

**Invoked as `/rigor:bug-hunt`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — it defines the **verification-first methodology** — evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, and the regression guard — plus the operating model, interaction protocol, and safety rails this skill follows.
**Mode:** AUDIT (reads + *executes* repros; no source fixes) · **Produces:** tiered findings with proof → `FINDINGS_REGISTER.md`; repro tests saved. The flagship skill.

## Phase 0 — Scope  *(checkpoint)*
Pick a component/subsystem (go deep, not wide — hunting a whole large repo at once produces blind spots). Read `GROUND_TRUTH.md` so you don't re-derive facts or re-flag tool findings. If it's absent, run `/rigor:ground-truth` first (recommended — it also yields the coverage/blind-spot map), or harvest the `§C` toolchain baseline for the scoped area yourself before hunting; never reason ahead of the toolchain.

## Phase 1 — Derive intent
Extract the **invariants, contracts, and assumptions** the scoped code must uphold — from types, docs, tests, and call sites. Write down what must *always* hold (pre/postconditions, state invariants, ordering/lifetime rules). Bugs are violations of these.

## Phase 2 — Hunt
Trace **control and data flow end-to-end** and probe the correctness lenses (`§7`): boundaries, null/empty, ordering, concurrency / races / TOCTOU, error paths, state-machine and contract violations, resource lifecycle, integer/precision, time, encoding. Generate **adversarial inputs and property checks** that would violate the invariants. Where exact correctness is hard to assert, use an **oracle** (`§7`: a reference/prior version, the spec, a parallel implementation, property generators, or round-trip/metamorphic relations). Use VCS history to target recently-changed, bug-prone areas.

## Phase 3 — Prove, then disconfirm, then refute  *(the differentiator)*
For each candidate: **prove it** with a failing test/repro on current code → **CONFIRMED** (save the repro); if you can't execute it, tier it **PROBABLE** (needs two independent evidence lines, `§A`) or **SPECULATIVE**. Then run the **disconfirmation pass** (`§B`) and drop what dies; record what you ruled out. Finally, for each surviving finding that will **drive a fix or block** and is **not** already backed by an executed repro, run an **independent refutation** (`§I`): a fresh `tracer` in refutation mode — one that did not find it — tries to kill it by locating a dominating guard in another function/file; **majority-REFUTED drops it or downgrades it to SPECULATIVE** with the cited guard. A CONFIRMED-by-repro bug skips this — the repro is the proof. Every reported finding carries a verbatim **Anchor** (`§E`).

## Phase 4 — Root cause & sibling sweep  *(`§G`)*
For each CONFIRMED bug, trace it to its **root cause** (not just the symptom) and **search the codebase for siblings** — other sites with the same cause/anti-pattern. Register siblings (tiered like any finding). The goal is to surface the whole *class*, so it can be fixed and enforced as one.

## Deliverables
`FINDINGS_REGISTER.md` entries (schema `§6`: tier, proof, `file:line`, root-cause, siblings, reachability, impact, disconfirmation), repro tests committed. Summary **led by CONFIRMED**. Honest coverage note: what you traced vs. didn't.

## Done when
The scoped code is traced against its invariants; every reported bug carries a tier + evidence; CONFIRMED bugs have a runnable repro, a root cause, and a sibling sweep; disconfirmation is done; coverage is stated.
