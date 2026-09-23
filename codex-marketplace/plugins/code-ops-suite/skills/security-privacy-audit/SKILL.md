---
name: security-privacy-audit
description: "Use for an adversarial security and privacy threat model deeper than the audit's lens. Anonymity egress, metadata, and fingerprints go to privacy-opsec-suite."
---

# Security and privacy audit: adversarial threat assessment

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:security-privacy-audit`.** First read §1, §3, §4, §7, §10, and §14 of the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section. Leave the rest of that file unread.
**Mode:** AUDIT · **Produces:** `THREAT_MODEL.md`, `SECURITY_PRIVACY_FINDINGS.md`, and
`EXECUTIVE_SUMMARY.md`. It feeds NEEDS-REVIEW and NEEDS-DESIGN items into
`FINDINGS_REGISTER.md`.

Run an adversarial deep-dive into the system's security posture, and into its privacy and
anonymity properties **in proportion to how much personal or sensitive data it handles**. Think
like an attacker auditing your *own* system in order to harden it. **This is defensive work.**
Findings describe vulnerabilities and their fixes, never weaponized exploits. Document by
default. Apply only trivial, obviously safe hardening with the developer's approval, such as a
missing security header, a cookie flag, or the redaction of a leaky log.

## Phase 0: the attack and data surface  *(checkpoint)*

Before broad reads, check the repo atlas when present with
`node <plugin-root>/scripts/atlas-check.mjs check --atlas <atlas dir>` (`<repo>-docs/98
System/Atlas/`, fallback `atlas/`), and query the symbol index with
`node <plugin-root>/scripts/co.mjs context query find <symbol>` before loading a map.
Dispatch an `explorer` operative to enumerate the **attack surface**: every entry point, input,
deserialization, upload, auth boundary, admin or debug surface, and client code. Have it define
the **trust boundaries** and the relevant **adversaries**: an external attacker, a passive or
active network observer, a malicious or compromised operator, a legal or subpoena demand, a
malicious peer, and a supply-chain attacker. Have it build a **data-flow map** for any personal
or sensitive data, covering where the data enters, flows, is stored, is logged, and is
transmitted, and to whom. Capture the baseline posture for headers, TLS, crypto, and secrets.

Create `ATTACK_CAMPAIGN.json` beside the security artifacts. It is a security-mode campaign,
not a generic work-plan or a file-write collision graph. Bind it to the version-4 run contract:
each family owner, hypothesis, launch, discoverer, and validator records the contract unit, wave,
and `role@model` routing stamp. Every family uses a distinct contract work unit; independent
agents may share a role and model. Finalization uses the dispatch journal's `actorId` to bind and
check the recorded host or session actor identifier; it is not cryptographic host attestation. A
validator must bind a different review or refutation unit whose
`validates` and `independentOf` fields name the hypothesis work unit. Set the concrete starting
privilege, impact goal, and a commonly
deployed configuration to test. Declare at least two distinct exploit families before any deep
tracing. Give every hypothesis one of `OPEN`, `BLOCKED`, `EXHAUSTED`, or `CLOSED`; keep the reason
or structured evidence for the non-open states.
Run `security chains check --campaign ATTACK_CAMPAIGN.json --contract RUN_CONTRACT.json --ledger
DISPATCH_LEDGER.md --root .` through the bundled `co.mjs` after every campaign update. The
compiler validates the supplied contract and reconciles the actual dispatch journal. Referenced
units must have ledger and journal records, and reported units need hash-bound artifacts. Planned
units may remain dispatched during an in-progress check. Add `--final` only at closure; it requires
strict all-unit reconciliation and every final artifact. Generate
`ATTACK_CHAIN_REPORT.md` from the matching `report` command and contract before each
reprioritization checkpoint.

Security discovery must come from direct source, runtime, framework, database, library,
dependency-source, configuration, test, or deployment inspection. Record each item as structured
provenance with a direct-source type, repository-relative artifact path, and SHA-256 digest,
including nested provenance. Every referenced artifact must exist inside the repository root and
match its digest. Do
**not** use Git history, changelogs, CVE databases, or patched-version diffs as discovery
shortcuts, even through a nested evidence reference. They can never close an attack chain. Where
behavior depends on implementation details, inspect the runtime, framework, database, libraries,
and dependency source directly. Do not use a blanket `not-applicable` claim for an
implementation-dependent chain; either provide direct evidence for every required layer or keep
the hypothesis open until the missing layer is inspected.

> **CHECKPOINT:** present the surface map, adversaries, data-flow map, privilege-to-impact goal,
> exploit-family roster, and common-deployment assumption. Confirm the scope and adversaries.

## Phase 1: the adversarial campaign

Fan out by **distinct exploit family**, not merely by the first promising sink. Assign each
operative a non-overlapping family and a hypothesis, then keep a campaign ledger of launches.
Do not allow the whole wave to converge on one primitive. Number launches monotonically. When
one family dominates the launch history, the next launch must be a fresh neglected hypothesis in
a non-dominant family. Continue immediate counter-launches until dominance clears; never deepen
the dominant family first. Record each hypothesis once. A later state change does not remove its
launch from convergence accounting.
Mark a failed path `BLOCKED` with its guard, and mark an exhausted family `EXHAUSTED` with the
search and evidence that ruled it out. Regularly add neglected-family launches until all declared
families have a real hypothesis.

**Security, through STRIDE.** Cover spoofing and authentication, tampering, repudiation,
information disclosure including injection, XSS, SSRF, IDOR, verbose errors, debug endpoints, and
secret exposure, denial of service, elevation of privilege, crypto and transport, configuration,
headers, CORS, cookies, and lockfile integrity. Inspect a dependency's installed source and its
actual call path; do not infer an issue from an advisory or version diff.

**Privacy, through LINDDUN,** at a depth scaled to the data sensitivity. Cover linking, meaning
correlatable identifiers across requests, logs, storage, and third parties. Cover identifying,
meaning re-identification, fingerprinting, quasi-identifiers, and anonymized data that
re-identifies. Cover non-repudiation as a harm. Cover detecting, meaning side channels in timing,
size, and error differences. Cover data disclosure, meaning PII in logs, telemetry, and errors,
metadata leakage, third-party SDKs and CDNs and what they exfiltrate, and observable egress.
Cover unawareness and control, asking whether the system is private by default. Cover
non-compliance, meaning minimization, retention, and deletion. Add the **insider and legal
threat**: what a malicious operator or a lawful demand could extract. Minimization is the
defense.

Model each security hypothesis as a directed chain of entry, guard, primitive, and sink nodes.
Every node must participate in at least one directed entry-to-sink path. Entry nodes have no
incoming edges and sink nodes have no outgoing edges. Treat every security
hypothesis as implementation-dependent and record every required direct-inspection layer.
Reverse-index canonical file and line locations across chains independently of node labels and
kinds. Trace every collision to its terminal or open tail. Link a blocked chain only when its
exact terminal location equals a reachable `OPEN` entry location. Rank `OPEN` chains by impact,
likelihood, and unique cross-chain location count, then send the highest-ranked chains to an **out-of-band independent
validator** that did not discover them. A validator tries to kill the chain by finding a
dominating guard or by disproving the common-deployment assumption. It returns a unique hashed
receipt that binds the hypothesis, status, validator unit, and routing stamp. Each direct
inspection layer uses its own hashed JSON receipt bound to the hypothesis and layer.

Do not stop at a primitive. A `CLOSED` security chain needs independent validation that survives,
a concrete execution receipt with the command and structured success result: exit code zero,
observed impact true, and starting privilege and impact equal to the campaign goal. The receipt
also carries a repository-relative reference, SHA-256 digest, and direct
evidence from the defined starting privilege to the defined impact. It also needs structured
evidence that the configuration is realistic and commonly deployed. Free-text assurance cannot
close a chain. An unclosed chain remains `OPEN`, `BLOCKED`, or `EXHAUSTED`; it is not a confirmed
finding. Findings use the schema
(`CONVENTIONS §7`), plus a **threat class** (`STRIDE-x` or `LINDDUN-x`), an **exploitability**, an
**adversary**, and a conceptual **attack or leak scenario**. Surface critical findings immediately
(`§3`).

## Deliverables

In a dated security folder:
- **`THREAT_MODEL.md`**: the surface, the adversaries, the trust boundaries, the data-flow map, and the threat catalogue with residual-risk notes. It is a durable, reusable artifact.
- **`ATTACK_CAMPAIGN.json`** and **`ATTACK_CHAIN_REPORT.md`**: exploit-family ownership and launches, hypothesis states, direct-inspection evidence, reverse collision index, ranked open chains, independent-validator receipts, and closed privilege-to-impact chains.
- **`SECURITY_PRIVACY_FINDINGS.md`**: the findings ranked by severity times exploitability, each with a scenario and a concrete remediation, led by a fix-first list. Route the NEEDS-REVIEW and NEEDS-DESIGN items into `FINDINGS_REGISTER.md`.
- **`EXECUTIVE_SUMMARY.md`**: the worst security *and* privacy risks, what was hardened, and the fixes that most reduce risk.

## Done when

- Every surface and data flow was assessed against STRIDE, and against LINDDUN to the depth warranted.
- Every declared exploit family has a distinct contract-bound operative and launched hypothesis;
  no dominant open family was deepened without a later non-dominant `OPEN` launch.
- Every implementation-dependent hypothesis records structured direct inspection. Every `CLOSED`
  chain has a concrete execution receipt, proves the realistic common-deployment
  start-privilege-to-impact goal, and survived a contract-bound independent validator.
- The reverse collision index and ranked open-chain list were reviewed, and their next validators were dispatched or explicitly deferred.
- Findings are ranked and carry scenarios and remediations.
- Critical findings were surfaced live.
- The threat model is reusable, and the confirmed hardening is verified.
- A final self-audit was done.
- `EXECUTIVE_SUMMARY.md` is presented first, with the worst risks at the top.
