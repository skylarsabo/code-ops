# privacy-opsec-suite

Adaptive, multi-agent workflows for building, auditing, and operating **privacy-respecting, anonymity-preserving** software — packaged as a Claude Code plugin. Each workflow is a namespaced skill (`/privacy-opsec-suite:<name>`) that runs a dynamic, conflict-aware multi-agent loop and checks in with you on the high-stakes calls. Every skill treats the **anonymity & OpSec model** as the central, non-negotiable constraint (see `CONVENTIONS.md`, §A).

**Stance:** defensive privacy engineering — protect your system's *own users'* anonymity and find/fix leaks in *your own* code. Anonymous-by-default, fail-closed.

## Skills

Invoke with `/privacy-opsec-suite:<name>`. All are manual-invoke (deliberate operations).

**Model & audits**
- `anonymity-threat-model` — map how a user could be deanonymized: adversaries, assets, deanonymization paths, residual risk (keystone artifact).
- `anon-session-audit` — are sessions truly unlinkable? identifiers, lifecycle, hidden persistent IDs, cross-session correlation.
- `tor-egress-audit` — no traffic leaks the user: proxy enforcement, **fail-closed**, DNS/WebRTC/IPv6 leaks, stream isolation, onion-service hygiene.
- `metadata-leak-audit` — minimize what leaks: PII in logs/telemetry/errors, embedded file metadata, headers, side channels, retention.
- `fingerprint-resistance` — make users indistinguishable: header/TLS/behavioral fingerprint surface and homogenization.
- `traffic-analysis-resistance` — reduce observable signatures: timing/size/volume side channels; padding/batching (with honest limits vs. a global passive adversary).
- `supply-chain-trust` — dependencies that don't betray anonymity: telemetry/egress, CVEs, build integrity.

**Build / respond** (writes code or proposes changes)
- `opsec-hardening` — implement the fixes from the leak backlog safely; each leak gets a regression test that fails if it returns.
- `privacy-feature-design` — find + specify high-value privacy/trust features, each gated against the anonymity model.
- `leak-incident-response` — triage, contain, scope blast radius, and plan remediation for a suspected leak — without making it worse.

**Docs / gate**
- `privacy-doc-alignment` — reconcile privacy promises / threat model / opsec runbooks against code; surface any **unkept promise**; establish the SSOT.
- `opsec-pr-gate` — pre-merge gate that **blocks** any change adding egress, logging, identifiers, fingerprint surface, correlation, or weakened defaults.

**Orchestrator**
- `full-sweep` — run the whole privacy/opsec suite end-to-end as one developer-in-the-loop pipeline (model → audits → harden → docs/gate), pausing at each phase boundary.

## The anonymity & OpSec model
`CONVENTIONS.md` (bundled at the plugin root) defines the shared backbone and, centrally (§A), the model every skill enforces:
- **Adversaries:** passive/active network observers, malicious operator/insider, hosting provider, legal/coercion, compromised dependency/build, malicious peer, and cross-session correlators.
- **Goals:** unlinkability, unobservability, deniability, data minimization.
- **Non-negotiables:** anonymous/private **by default**; **fail closed** (never fall back to clearnet); no new egress/log/identifier/fingerprint/dependency without scrutiny; minimize metadata; never weaken a guarantee silently.

For always-on application, add a pointer in your repo's `CLAUDE.md` to this plugin's `CONVENTIONS.md`.

## Subagents
- `explorer` — read-only, fast model; parallel leak-aware investigation (egress, logging, identifiers, routing, metadata). Never edits, never emits real identifiers.
- `privacy-reviewer` — strong model; parallel review of diffs/file-groups against the model; flags anonymity regressions as blocking. Never edits.

## Loops & automation
- **In-session loop:** drive a skill to its "Done when" criteria with `/loop`.
- **On every PR:** wire `opsec-pr-gate` into CI with `anthropics/claude-code-action@v1` — see `examples/github-opsec-gate.yml` (canonical setup: `/install-github-app`, then paste the criteria).
- **Recurring:** put `tor-egress-audit`, `metadata-leak-audit`, and `supply-chain-trust` on a schedule (Routines / `/schedule`).
- **Deterministic backstops:** pre-commit secret scanning, a dependency bot for CVEs, and CI checks that fail on a clearnet connection or unredacted-log pattern complement the judgment-heavy skills.

## How they chain
Stable IDs across the lifecycle (`EGRESS-003` → `LEAK_REGISTER.md` → commit/PR → log):
- `anonymity-threat-model` frames the audits → `anon-session-audit` / `tor-egress-audit` / `metadata-leak-audit` / `fingerprint-resistance` / `traffic-analysis-resistance` / `supply-chain-trust` → `LEAK_REGISTER.md` → `opsec-hardening` → `opsec-pr-gate`
- `leak-incident-response` feeds urgent items into the same backlog
- `privacy-doc-alignment` keeps promises/threat-model/runbooks true; `privacy-feature-design` proposes trust-building features

## Notes
- Works on any stack; skills self-detect tooling and match the repo's conventions.
- Optional tools (docs lookup, VCS history, browser/UI, read-only network/proxy inspection) are used if connected and skipped otherwise.
- Skills never emit real identifiers, IPs, or user data; analysis works from redacted samples and patterns.
- Pairs well with the general-purpose **code-ops-suite** plugin: use that for broad engineering work, this for the anonymity/opsec specialization.
