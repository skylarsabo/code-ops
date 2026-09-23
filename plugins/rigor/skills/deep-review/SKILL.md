---
description: "Use for a pre-merge review of a PR or diff. bar verified (default) blocks only on CONFIRMED defects; bar standard reviews every quality lens with unproven items advisory."
---

# Deep review: a pre-merge review at a chosen bar

**Invoked as `/rigor:deep-review`.** Read §A, §B, §C, §D, §E, §G, §H, §I, §1, §3, §4, §7, §11, and §12 of
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It defines the verification-first methodology
(evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and
the regression guard), plus the operating model, the interaction protocol, the safety
rails, and the code standard this skill follows. Leave the rest of that file unread.

- **Mode:** REVIEW. It changes nothing unless you ask. When asked to fix rather than flag,
  switch to the implementation loop and its code standard (`§12`).
- **Bar:** `bar: verified` (the default) or `bar: standard`. Name the bar with the request.
- **Produces:** tiered `file:line` comments and a verdict. They go to the pull request when
  a version-control tool is connected, and to `REVIEW.md` otherwise. The Blocking and
  Should-fix items are also written to `FINDINGS_REGISTER.md`, so the register gate checks them.

## The two bars

- **`bar: verified`** is the verification bar. It applies the defect-oriented lenses and blocks
  only on a CONFIRMED defect or regression. The suite's local review gate and the
  `local-deep-review` status always run this bar.
- **`bar: standard`** is the all-lens senior review. It adds design, size, performance,
  security, privacy, UI, tests, docs, and conventions to the verified lenses. A finding that
  is not reproduced stays advisory: it ships as Should-fix or Nit, never as Blocking, and its
  tier is labeled.

Both bars share Phase 0, the proof rules, the output shape, and the register gate. For an
anonymity gate, use `privacy-opsec-suite:opsec-pr-gate` instead.

## Phase 0: understand the change and its reach

Pull the diff, its intent from the description and any linked issue or specification, and
the surrounding code. Review the diff against the code it changes, never in isolation. Run
the `GROUND_TRUTH` tooling on the branch, meaning typecheck, lint, and tests, so the review
starts from facts. For a large diff, fan out to the tracer/verifier subagents per file group
or concern, and synthesize one coherent review from their reports. For a changed exported
symbol, a shared type or schema, or an API or database contract, use a `tracer` to locate
its dependents, so that ranking reflects demonstrated reach (`§D`) rather than diff size. A
small diff in a shared contract is a large review.

## Phase 1: review against the lenses, with proof

Apply the correctness, failure-handling, consistency, and defect-causing-maintainability
lenses (`§7`). Reproduce each concern where that is feasible, with a failing test or a
trace, which makes it CONFIRMED. Otherwise tier it PROBABLE or SPECULATIVE and label it.
Run the disconfirmation pass (`§B`) on every concern.

Check that the change does not introduce an inconsistency, does not regress an existing
enforcement or a prior proof (`§H`), and does not land behavior without a test. Run a quick
bisect or history check if the change looks like it reverts a past fix.

At `bar: standard`, also apply these lenses:

- **Design and modularity:** does it fit the architecture, without new coupling or duplication, right-sized rather than over- or under-engineered?
- **Size and boundary:** is it the smallest change that satisfies the ordered objective, with no new file, interface, wrapper, or dependency added without the ladder's evidence (`§12`)?
- **Performance and efficiency:** does it regress anything?
- **Security:** does it introduce a weakness?
- **Privacy and data handling:** does it add collection, leakage, or correlation surface, or weaken a default? Scale the priority to the system's data sensitivity.
- **UI, theming, and accessibility** for UI changes: tokens, all states, and parity, verified with the UI tool.
- **Tests:** are they present, meaningful, and covering the change's logic and its edge and error paths?
- **Docs:** are they updated where behavior or contracts changed?
- **Conventions:** does the change match the repo's style and patterns?

The mechanical floor under the size-and-boundary lens is
`node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs scan overbuild --git <range>` over the reviewed range.
It blocks only on an unrecorded dependency, and its other tells are leads for the lens rather
than review comments on their own.

For any concern you would mark Blocking whose severity rests on static reasoning rather than
an executed repro, run an independent refutation (`§I`). A fresh refuter, one that did not
raise the concern, tries to kill it by locating a dominating guard elsewhere, and a refuted
concern is dropped or downgraded, citing the guard. Each comment carries a verbatim Anchor of
its cited line (`§E`).

## Output: the review

Write comments at `file:line`, each with a tier and a concrete suggested fix, grouped into
three levels:

- **Blocking**, for a CONFIRMED defect or regression. At `bar: standard` this also covers a reproduced security or privacy regression, broken contract, or missing critical test.
- **Should-fix**, for a PROBABLE or quality item, including every unreproduced finding at `bar: standard`.
- **Nit**, clearly labeled and low-pressure.

Surface the blocking items at the top, and note briefly what is done well. End with a
verdict, which is approve, approve-with-nits, or request-changes, and a two- or three-line
quality and risk read. Do not inflate a tier. Do not block on a SPECULATIVE item, and do not
wave through a CONFIRMED defect.

## Done when

The change is reviewed at the named bar, and every changed file was reviewed against that
bar's lenses. CONFIRMED issues carry repros. Consistency, enforcements, and regressions are
checked, UI changes were verified at `bar: standard`, and the verdict is calibrated, with the
blocking items first. When asked to fix rather than flag, the run switched to the
implementation loop. Every Blocking and Should-fix comment is also an entry in
`FINDINGS_REGISTER.md`, and that register passes
`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root . --strict --profile finding-rigor`
with exit 0. A CONFIRMED item's Proof cites its `RCPT-NNN` receipt from
`node ${CLAUDE_PLUGIN_ROOT}/scripts/run-proof.mjs record -- <repro>` or a kept repro file,
or the item is re-tiered PROBABLE and cannot block.
