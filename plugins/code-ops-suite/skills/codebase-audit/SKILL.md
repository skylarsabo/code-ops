---
description: "Use when you want a broad, multi-lens review of an unfamiliar or drifting codebase; writes a ranked findings backlog, applies only safe fixes."
disable-model-invocation: true
---

# CODEBASE AUDIT — Broad Multi-Lens Review

**Invoked as `/code-ops-suite:codebase-audit`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** AUDIT · **Produces:** `FINDINGS_REGISTER.md`, `FEATURE_OPPORTUNITIES.md` (any opportunities noticed), reconciled-doc notes, `EXECUTIVE_SUMMARY.md`, `REMEDIATION_LOG.md` (for applied NOW-SAFE fixes).

A thorough, in-depth review across every relevant quality lens (`CONVENTIONS §10`), over every service/module. Apply only **NOW-SAFE** fixes (with the developer's OK on each batch); document everything else as findings for the remediation prompt.

## Phase 0 — Discovery & scoping  *(checkpoint)*
Detect the stack and tooling; build the real **service/module inventory** (purpose, entrypoints, public surface, dependencies, data touched); capture the build/test/lint **baseline** (and pre-existing failures); open a **coverage ledger** (every area × every applicable lens). Draft the orchestration plan (concern × scope matrix).
> **CHECKPOINT:** present the inventory, baseline, and plan; confirm scope (areas to include/skip/prioritize, any off-limits paths). Then proceed.

## Phase 1 — Adaptive review
Run the loop (`CONVENTIONS §1`). Each sub-agent applies the relevant lenses (`§10`) to its slice and returns findings in the finding schema (`§7`), classified by track (`§6`). Deepen on dense/risky areas; converge and check off clean ones. **Surface critical findings to the developer immediately** (`§3`). Apply confirmed NOW-SAFE fixes via the implementation loop (`§11`), logging each.

At synthesis, route every **critical/high-severity or fix-driving** finding through **independent refutation** (`§7`): a fresh sub-agent that did not find it tries to kill it by locating a dominating guard/handler in another function, file, or boundary; a majority-refuted finding drops or downgrades to SPECULATIVE with the cited guard. Skip the panel only for a finding already proven by an executed repro. Every reported finding quotes a verbatim **Anchor** of its cited line (`§9`).

Pay particular attention to the priorities most likely to matter: **modularity, performance, intricate correctness bugs**, plus **security** and (scaled to the system's data sensitivity) **privacy/data handling**, and — for UIs — **styling/theming/a11y consistency** (use the UI tool to inspect live).

## Deliverables
Per `CONVENTIONS §12`, under a dated audit folder:
- **`FINDINGS_REGISTER.md`** — the authoritative backlog: all NEEDS-REVIEW + NEEDS-DESIGN findings (schema `§7`), grouped by lens, ranked, led by a "top N highest-value." Actionable cold.
- **`REMEDIATION_LOG.md`** — applied NOW-SAFE fixes (what/why/files/commit/verification).
- **`FEATURE_OPPORTUNITIES.md`** — opportunities noticed in passing (hand to the discovery prompt to develop).
- **`EXECUTIVE_SUMMARY.md`** — coverage, baseline→after, counts by severity/lens, biggest risks, highest-value next actions.

## Done when
Coverage ledger 100%; every finding has evidence + recommendation + track and a `Verified-at: <sha>` stamp at current HEAD (`CONVENTIONS §7`, §12); applied fixes verified (build/tests green, no worse than baseline); deliverables internally consistent; a final self-audit for vagueness, contradictions, and dedup. The finished FINDINGS_REGISTER.md passes `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` with exit 0 — a non-FRESH citation is re-located against the real tree or dropped before the run is done (`§9`). Present `EXECUTIVE_SUMMARY.md` first, worst risks at the top.
