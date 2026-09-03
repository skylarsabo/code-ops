---
name: privacy-opsec-suite-opsec-pr-gate
description: "Use when you want a pre-merge gate that blocks any change adding egress, logging, identifiers, fingerprint surface, correlation, or weakened anonymity defaults. The anonymity counterpart to code-ops-suite:pr-review and rigor:deep-review."
---

# OpSec pull request gate: block anonymity regressions before merge

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/privacy-opsec-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/privacy-opsec-suite-opsec-pr-gate`, or by the model through the `skill` tool as `privacy-opsec-suite-opsec-pr-gate`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** REVIEW. Name the pull request, branch, or diff.
- **Produces:** a prioritized review and a verdict. They go to the pull request when a
  version-control tool is connected, and to `REVIEW.md` otherwise.
- **Default:** review only.

## Phase 0. Understand the change

Pull the request or diff, its intent from the description and any linked issue, leak ID, or
specification, and the surrounding code. For a large pull request, fan out to the
privacy-reviewer subagent and synthesize the reports.

## Phase 1. Review against the anonymity and opsec model

Apply the lenses (`§9`). Treat each of these as a BLOCKING regression:

- a new egress path, or a fallback that bypasses the proxy or breaks fail-closed behavior
- a new log line touching personal data, identifiers, or IP addresses, or added telemetry
- a new identifier, cookie, or fingerprint vector, or anything that increases cross-session
  linkability
- a new correlation surface in timing, size, or volume, or a new metadata leak
- a new third-party dependency that phones home or opens egress
- any weakened default, meaning less anonymity by default or privacy made opt-in

Also verify that fail-closed behavior still holds, that metadata is still minimized, and
that stream isolation is not undone. Review the diff against the surrounding code.

## Output: the review

Write prioritized comments at `file:line`, each with a concrete fix, grouped into three
levels:

- **Blocking**, for any anonymity or leak regression.
- **Should-fix**.
- **Nit**.

Add an overall verdict, which is approve, approve-with-nits, or request-changes, and a risk
read of two or three lines. Do not approve anything that weakens anonymity.

## Done when

The change is reviewed against the model. Every anonymity and leak regression is caught and
marked blocking with a concrete fix, and a clear verdict is given.
