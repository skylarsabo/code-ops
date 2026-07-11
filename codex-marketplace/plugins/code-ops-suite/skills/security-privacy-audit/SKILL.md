---
name: security-privacy-audit
description: "Use when you need an adversarial security + privacy threat assessment of attack surface and deanonymization paths — deeper than the audit's security lens. For anonymity-specific egress/metadata/fingerprint work, use the privacy-opsec-suite."
---

# SECURITY & PRIVACY AUDIT — Adversarial Threat Assessment

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:security-privacy-audit`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** AUDIT · **Produces:** `THREAT_MODEL.md`, `SECURITY_PRIVACY_FINDINGS.md`, `EXECUTIVE_SUMMARY.md`; feeds NEEDS-REVIEW/NEEDS-DESIGN items into `FINDINGS_REGISTER.md`.

An adversarial deep-dive into the system's security posture and, **proportional to how much personal/sensitive data it handles**, its privacy/anonymity properties. Think like an attacker auditing your *own* system to harden it. **Defensive work: findings describe vulnerabilities and their fixes — not weaponized exploits.** Document by default; apply only trivial, obviously-safe hardening with the developer's OK (e.g. a missing security header, a cookie flag, redacting a leaky log).

## Phase 0 — Map the attack & data surface  *(checkpoint)*
Enumerate the **attack surface** (every entry point, input, deserialization, upload, auth boundary, admin/debug surface, client code); define **trust boundaries** and the relevant **adversaries** (external attacker, passive/active network observer, malicious/compromised operator, legal/subpoena demand, malicious peer, supply-chain attacker); build a **data-flow map** for any personal/sensitive data (where it enters, flows, is stored, logged, transmitted, and to whom). Baseline current headers/TLS/crypto/secrets posture.
> **CHECKPOINT:** present the surface map, adversaries, and data-flow map; confirm scope and which adversaries to emphasize.

## Phase 1 — Adversarial assessment
Fan out per surface / data-flow / threat class.
- **Security — STRIDE:** Spoofing/authn, Tampering, Repudiation, Information disclosure (incl. injection, XSS, SSRF, IDOR, verbose errors, debug endpoints, secret exposure), Denial of service, Elevation of privilege. Plus crypto/transport, config/headers/CORS/cookies, and a **deep dependency-CVE pass** with lockfile integrity.
- **Privacy — LINDDUN** *(depth scaled to data sensitivity):* Linking (correlatable identifiers across requests/logs/storage/third parties), Identifying (re-identification, fingerprinting, quasi-identifiers, "anonymized" data that re-identifies), Non-repudiation as harm, Detecting (side channels: timing/size/error differences), Data disclosure (PII in logs/telemetry/errors; metadata leakage; third-party SDKs/CDNs and what they exfiltrate; observable egress), Unawareness/control (private-by-default?), Non-compliance (minimization, retention, deletion). Plus the **insider & legal threat**: what could a malicious operator or lawful demand extract? Minimization is the defense.

Findings use the schema (`CONVENTIONS §7`) plus **threat class (STRIDE-x | LINDDUN-x)**, **exploitability**, **adversary**, and an **attack/leak scenario** (conceptual). Surface criticals immediately (`§3`).

## Deliverables (dated security folder)
- **`THREAT_MODEL.md`** — surface, adversaries, trust boundaries, data-flow map, threat catalogue with residual-risk notes. A durable, reusable artifact.
- **`SECURITY_PRIVACY_FINDINGS.md`** — findings ranked by severity × exploitability, each with a scenario and concrete remediation; led by a "fix-first" list. Route NEEDS-REVIEW/NEEDS-DESIGN into `FINDINGS_REGISTER.md`.
- **`EXECUTIVE_SUMMARY.md`** — the worst security *and* privacy risks, what was hardened, and the fixes that most reduce risk.

## Done when
Every surface and data-flow assessed against STRIDE (and LINDDUN to the depth warranted); findings ranked with scenarios + remediations; criticals surfaced live; the threat model is reusable; confirmed hardening verified; a final self-audit. Present `EXECUTIVE_SUMMARY.md` first, worst risks at the top.
