---
description: "Use when you want a pre-merge gate that blocks any change adding egress, logging, identifiers, fingerprint surface, correlation, or weakened anonymity defaults. The anonymity counterpart to code-ops-suite:pr-review and rigor:deep-review."
disable-model-invocation: true
---

# OPSEC PR GATE — Block Anonymity Regressions Before Merge

**Invoked as `/privacy-opsec-suite:opsec-pr-gate`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** REVIEW (name the PR/branch/diff) · **Produces:** prioritized review + verdict (PR comments if a VCS tool is connected, else `REVIEW.md`). Review-only by default.

## Phase 0 — Understand the change
Pull the PR/diff and its intent (description, linked issue/leak ID/spec) and the surrounding code. For large PRs, fan out to the privacy-reviewer subagent and synthesize.

## Phase 1 — Review against the anonymity/opsec model
Apply the lenses (`§9`). Treat these as **BLOCKING** regressions:
- a new **egress path** or a fallback that bypasses the proxy / breaks fail-closed
- a new **log line** touching PII/identifiers/IPs, or telemetry added
- a new **identifier, cookie, or fingerprint vector**, or anything that increases cross-session linkability
- a new **correlation surface** (timing/size/volume) or new metadata leak
- a new **third-party dependency** that phones home or opens egress
- any **weakened default** (less-anonymous by default, opt-in privacy)
Also verify **fail-closed still holds**, metadata is still minimized, and stream isolation isn't undone. Review the diff against surrounding code.

## Output — the review
Prioritized comments at `file:line` with concrete fixes — **Blocking** (any anonymity/leak regression) / **Should-fix** / **Nit** — plus an overall **verdict** (approve / approve-with-nits / request-changes) and a 2–3 line risk read. **Do not approve anything that weakens anonymity.**

## Done when
The change is reviewed against the model; every anonymity/leak regression is caught and marked blocking with a concrete fix; a clear verdict is given.
