---
name: codebase-audit
description: "Use when you want a broad, multi-lens review of an unfamiliar or drifting codebase. It writes a ranked findings backlog and applies only safe fixes."
---

# CODEBASE AUDIT: Broad Multi-Lens Review

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:codebase-audit`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** AUDIT · **Produces:** `FINDINGS_REGISTER.md`, `FEATURE_OPPORTUNITIES.md` for any
opportunities noticed, reconciled-doc notes, `EXECUTIVE_SUMMARY.md`, and `REMEDIATION_LOG.md`
for applied NOW-SAFE fixes.

Run a thorough review across every relevant quality lens (`CONVENTIONS §10`), over every service
and module. Apply only **NOW-SAFE** fixes, with the developer's approval on each batch. Document
everything else as findings for the remediation prompt.

## Phase 0: discovery and scope  *(checkpoint)*

Dispatch an `explorer` operative to detect the stack and tooling and to build the real **service
and module inventory**: purpose, entrypoints, public surface, dependencies, and data touched.
Hand its summary onward. Capture the build, test, and lint **baseline**, including any
pre-existing failures. Open a **coverage ledger** covering every area against every applicable
lens. Draft the orchestration plan as a concern-against-scope matrix.

> **CHECKPOINT:** present the inventory, the baseline, and the plan. Confirm the scope: which areas to include, skip, or prioritize, and any off-limits paths. Then proceed.

## Phase 1: the adaptive review

Run the loop (`CONVENTIONS §1`). Each sub-agent applies the relevant lenses (`§10`) to its slice
and returns findings in the finding schema (`§7`), classified by track (`§6`). Deepen on dense
or risky areas. Converge and check off the clean ones. **Surface critical findings to the
developer immediately** (`§3`). Apply confirmed NOW-SAFE fixes through the implementation loop
(`§11`), logging each one.

At synthesis, route every **critical, high-severity, or fix-driving** finding through
**independent refutation** (`§7`). A fresh sub-agent that did not find it tries to kill it by
locating a dominating guard or handler in another function, file, or boundary. A majority-refuted
finding drops, or downgrades to SPECULATIVE with the cited guard. Skip the panel only for a
finding already proven by an executed repro. Every reported finding quotes a verbatim **Anchor**
of its cited line (`§9`).

Pay particular attention to the priorities most likely to matter: modularity, performance,
intricate correctness bugs, security, and privacy and data handling scaled to the system's data
sensitivity. For a UI, add styling, theming, and accessibility consistency, and use the UI tool
to inspect the running interface.

Apply the **size and boundary** lens on the same pass. The mechanical floor under it is
`node <plugin-root>/scripts/co.mjs scan overbuild --git <range>`, which reports eight
over-build tells on a diff and blocks only on an unrecorded dependency. Treat its other tells as
leads for the lens, not as findings on their own.

## Deliverables

Per `CONVENTIONS §12`, under a dated audit folder:
- **`FINDINGS_REGISTER.md`:** the authoritative backlog, holding all NEEDS-REVIEW and NEEDS-DESIGN findings in schema `§7`, grouped by lens, ranked, and led by a top-N highest-value list. It must be actionable cold.
- **`REMEDIATION_LOG.md`:** the applied NOW-SAFE fixes, with what changed, why, which files, the commit, and the verification.
- **`FEATURE_OPPORTUNITIES.md`:** opportunities noticed in passing, to hand to the discovery prompt.
- **`EXECUTIVE_SUMMARY.md`:** coverage, the baseline against the after state, counts by severity and lens, the biggest risks, and the highest-value next actions.

## Done when

- The coverage ledger reads 100 percent.
- Every finding carries evidence, a recommendation, a track, and a `Verified-at: <sha>` stamp at current HEAD (`CONVENTIONS §7`, `§12`).
- Applied fixes are verified, with build and tests green and no worse than baseline.
- The deliverables are internally consistent, after a final self-audit for vagueness, contradictions, and duplicates.
- The finished `FINDINGS_REGISTER.md` passes `node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` with exit 0. Re-locate a non-FRESH citation against the real tree, or drop it, before the run is done (`§9`).
- `EXECUTIVE_SUMMARY.md` is presented first, with the worst risks at the top.
