# Privacy OpSec Suite for Codex

> Generated in the code-ops repository (https://github.com/skylarsabo/code-ops) by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.

Adaptive, multi-agent workflows for building, auditing, and operating privacy-respecting, anonymity-preserving software. Covers the anonymity threat model, anonymous sessions, Tor/proxy egress and leak prevention, metadata minimization, fingerprinting and traffic-analysis resistance, supply-chain trust, opsec hardening, privacy feature design, leak incident response, doc alignment, and an opsec PR gate. Anonymous-by-default, fail-closed, developer-in-the-loop.

## Use

Name a workflow in Codex as `privacy-opsec-suite:<skill>`. Every generated skill sets `policy.allow_implicit_invocation: true`, matching the Claude-side model-invocable policy.

## Skills

- `anon-session-audit` — Use when you need to verify sessions are truly unlinkable. Owns linkability and session identity, not network egress or file metadata.
- `anonymity-threat-model` — Use when you need the keystone anonymity threat model that the other privacy audits build on.
- `authorship-hygiene` — Use when a commit, PR, or branch must carry no AI or tooling trace before publishing.
- `fingerprint-resistance` — Use to reduce the fingerprinting and uniqueness surface that could re-link anonymous users. Traffic timing and size belong to traffic-analysis-resistance.
- `leak-incident-response` — Use when an anonymity or privacy leak is suspected and you need to triage, contain, scope the blast radius, and plan remediation without making it worse.
- `metadata-leak-audit` — Use to find PII or identifiers leaking in logs, telemetry, errors, headers, or file metadata. Timing and size side channels go to traffic-analysis-resistance.
- `opsec-hardening` — Use when a LEAK_REGISTER.md exists and you want its leaks fixed safely, each pinned with a regression test. Requires a register as input.
- `opsec-pr-gate` — Use as a pre-merge gate that blocks egress, logging, identifiers, fingerprints, correlation, or weaker anonymity defaults. Anonymity twin of rigor:deep-review.
- `privacy-doc-alignment` — Use when privacy promises, the threat model, or opsec runbooks have drifted from code and you want them reconciled into the single source of truth.
- `privacy-feature-design` — Use when you want high-value privacy and trust features found and specified, each gated against the anonymity model. Discovery and specification only.
- `supply-chain-trust` — Use to vet dependencies for telemetry, phone-home behavior, and egress, for CVEs, and for build and lockfile integrity under an anonymity-hostile model.
- `tor-egress-audit` — Use when you need to prove no traffic escapes the proxy or Tor. Owns network egress and routing.
- `traffic-analysis-resistance` — Use to reduce timing, size, and volume side channels and add padding or batching defaults. Header and TLS fingerprints belong to fingerprint-resistance.

## Packaging notes

- The complete workflow text and conventions are rendered from `plugins/privacy-opsec-suite/` in the code-ops repository.
- Claude-specific GitHub Action examples are intentionally not bundled here.
- Root-level `agents/*.md` files are collaboration-subagent briefing templates. Their machine-readable minimum tiers are in `agents/model-floors.json`; the lead selects a supported runtime model before dispatch.

For source history and release notes, see the generated `CHANGELOG.md` and the repository root.
