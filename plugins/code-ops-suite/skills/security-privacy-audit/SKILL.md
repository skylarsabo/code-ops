---
description: "Use when you need an adversarial security and privacy threat assessment of attack surface and deanonymization paths, deeper than the audit's security lens. For anonymity-specific egress, metadata, and fingerprint work, use the privacy-opsec-suite."
---

# SECURITY AND PRIVACY AUDIT: Adversarial Threat Assessment

**Invoked as `/code-ops-suite:security-privacy-audit`.** First read the
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
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

Dispatch an `explorer` operative to enumerate the **attack surface**: every entry point, input,
deserialization, upload, auth boundary, admin or debug surface, and client code. Have it define
the **trust boundaries** and the relevant **adversaries**: an external attacker, a passive or
active network observer, a malicious or compromised operator, a legal or subpoena demand, a
malicious peer, and a supply-chain attacker. Have it build a **data-flow map** for any personal
or sensitive data, covering where the data enters, flows, is stored, is logged, and is
transmitted, and to whom. Capture the baseline posture for headers, TLS, crypto, and secrets.

> **CHECKPOINT:** present the surface map, the adversaries, and the data-flow map. Confirm the scope and which adversaries to emphasize.

## Phase 1: the adversarial assessment

Fan out per surface, per data flow, and per threat class.

**Security, through STRIDE.** Cover spoofing and authentication, tampering, repudiation,
information disclosure including injection, XSS, SSRF, IDOR, verbose errors, debug endpoints, and
secret exposure, denial of service, and elevation of privilege. Add crypto and transport, config
and headers and CORS and cookies, and a **deep dependency-CVE pass** with lockfile integrity.

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

Findings use the schema (`CONVENTIONS §7`), plus a **threat class** (`STRIDE-x` or `LINDDUN-x`),
an **exploitability**, an **adversary**, and a conceptual **attack or leak scenario**. Surface
critical findings immediately (`§3`).

## Deliverables

In a dated security folder:
- **`THREAT_MODEL.md`**: the surface, the adversaries, the trust boundaries, the data-flow map, and the threat catalogue with residual-risk notes. It is a durable, reusable artifact.
- **`SECURITY_PRIVACY_FINDINGS.md`**: the findings ranked by severity times exploitability, each with a scenario and a concrete remediation, led by a fix-first list. Route the NEEDS-REVIEW and NEEDS-DESIGN items into `FINDINGS_REGISTER.md`.
- **`EXECUTIVE_SUMMARY.md`**: the worst security *and* privacy risks, what was hardened, and the fixes that most reduce risk.

## Done when

- Every surface and data flow was assessed against STRIDE, and against LINDDUN to the depth warranted.
- Findings are ranked and carry scenarios and remediations.
- Critical findings were surfaced live.
- The threat model is reusable, and the confirmed hardening is verified.
- A final self-audit was done.
- `EXECUTIVE_SUMMARY.md` is presented first, with the worst risks at the top.
