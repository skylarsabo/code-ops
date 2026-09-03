# privacy-opsec-suite

Adaptive, multi-agent workflows for building, auditing, and operating privacy-respecting,
anonymity-preserving software. This repository authors the package for Claude Code and
renders it into a native Codex package. Invoke `/privacy-opsec-suite:<name>` in Claude Code,
or name `privacy-opsec-suite:<name>` in Codex. Every skill treats the anonymity and OpSec
model as the central, non-negotiable constraint. `CONVENTIONS.md` section A defines it.

**Stance:** defensive privacy engineering. Protect the anonymity of your system's own users,
and find and fix the leaks in your own code. Anonymous by default, fail-closed.

New to the suite? Read the handbook at `code-ops-docs/40 Engineering/Handbook/` from the
repository root.

## Skills

Invoke a skill with `/privacy-opsec-suite:<name>` in Claude Code, or name
`privacy-opsec-suite:<name>` in Codex. The model can also route to one through the
standard-operating-mode routing card. An anonymity-affecting phase stays gated at every
automation level.

**Model and audits**

- `anonymity-threat-model`. Map how a user could be deanonymized: adversaries, assets,
  deanonymization paths, and residual risk. The keystone artifact.
- `anon-session-audit`. Establish whether sessions are truly unlinkable, covering
  identifiers, lifecycle, hidden persistent IDs, and cross-session correlation.
- `tor-egress-audit`. Establish that no traffic leaks the user, covering proxy enforcement,
  fail-closed behavior, DNS, WebRTC, and IPv6 leaks, stream isolation, and onion-service
  hygiene.
- `metadata-leak-audit`. Minimize what leaks: personal data in logs, telemetry, and errors,
  embedded file metadata, headers, side channels, and retention.
- `fingerprint-resistance`. Make users indistinguishable by homogenizing the header, TLS,
  and behavioral fingerprint surface.
- `traffic-analysis-resistance`. Reduce observable signatures: timing, size, and volume side
  channels, with padding and batching, and with honest limits against a global passive
  adversary.
- `supply-chain-trust`. Vet dependencies that could betray anonymity, covering telemetry and
  egress, CVEs, and build integrity.

**Build and respond**, which writes code or proposes changes:

- `opsec-hardening`. Implement the fixes from the leak backlog safely. Each leak gets a
  regression test that fails if the leak returns.
- `privacy-feature-design`. Find and specify high-value privacy and trust features, each
  gated against the anonymity model.
- `leak-incident-response`. Triage, contain, scope the blast radius, and plan the
  remediation for a suspected leak, without making it worse.
- `authorship-hygiene`. Remove AI and tooling trace from a commit, a pull request, or a
  branch, across metadata, prose voice, and code idiom. It runs the bundled
  `scan-ai-tells.mjs` fail-closed before publishing.

**Documentation and gate**

- `privacy-doc-alignment`. Reconcile privacy promises, the threat model, and the opsec
  runbooks against the code. Surface any unkept promise and establish the single source of
  truth.
- `opsec-pr-gate`. A pre-merge gate that blocks any change adding egress, logging,
  identifiers, fingerprint surface, correlation, or weakened defaults.

**Orchestrator**

- `full-sweep`. Run the whole suite end to end as one developer-in-the-loop pipeline, from
  model to audits to hardening to documentation and gate, pausing at each phase boundary.

## The anonymity and OpSec model

`CONVENTIONS.md`, bundled at the plugin root, defines the shared backbone and, in section A,
the model every skill enforces:

- **Adversaries:** passive and active network observers, a malicious operator or insider,
  the hosting provider, legal coercion, a compromised dependency or build, a malicious peer,
  and cross-session correlators.
- **Goals:** unlinkability, unobservability, deniability, and data minimization.
- **Non-negotiables:** anonymous and private by default, fail closed with no clearnet
  fallback, no new egress path, log line, identifier, fingerprint, or dependency without
  scrutiny, minimized metadata, and no guarantee ever weakened silently.

To apply the model always, add a pointer in your repository's `CLAUDE.md` to this plugin's
`CONVENTIONS.md`.

## Subagents

- `explorer`. Read-only, at the light tier. It runs parallel leak-aware investigation across
  egress, logging, identifiers, routing, and metadata. It never edits and never emits a real
  identifier.
- `privacy-reviewer`. At the strong tier. It reviews diffs and file groups against the model
  in parallel, and flags an anonymity regression as blocking. It never edits.

## Loops and automation

- **In-session loop.** Drive a skill to its "Done when" criteria with `/loop`.
- **On every pull request.** Wire `opsec-pr-gate` into CI with the Claude Code action pinned
  to a reviewed commit. See `examples/github-opsec-gate.yml`. The canonical setup is
  `/install-github-app`, then paste the criteria.
- **Recurring.** Put `tor-egress-audit`, `metadata-leak-audit`, and `supply-chain-trust` on a
  schedule with `/schedule`.
- **Deterministic backstops.** Pre-commit secret scanning, a dependency bot for CVEs, and CI
  checks that fail on a clearnet connection or an unredacted-log pattern complement the
  judgment-heavy skills.

## How the skills chain

A stable ID travels the whole lifecycle, from `EGRESS-003` to `LEAK_REGISTER.md` to the
commit or pull request to the log:

- `anonymity-threat-model` frames the audits. `anon-session-audit`, `tor-egress-audit`,
  `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, and
  `supply-chain-trust` then feed `LEAK_REGISTER.md`, which feeds `opsec-hardening` and then
  `opsec-pr-gate`.
- `leak-incident-response` feeds urgent items into the same backlog.
- `privacy-doc-alignment` keeps the promises, the threat model, and the runbooks true.
  `privacy-feature-design` proposes trust-building features.

## Context economy

Every operative brief in this plugin reads files, and a large file read whole is the single
largest avoidable cost in a run. Two bundled scripts cut it:

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs context skim <file>` prints a file's outline,
  meaning its imports, symbols, and line counts, so a brief can then read one range instead
  of the whole file.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs <domain> <verb>` is the one entrypoint over
  every bundled script. `scan ai-tells`, `scan redaction`, `scan injection`,
  `register revalidate`, `run preflight`, and `context map` all reach a bundled script this
  way, and the direct paths still work.

The suite ships further context mechanisms, on by default, in `code-ops-suite`: a
`PreToolUse` output digest, a `SubagentStart` ladder card, and a symbol index refreshed by a
`PostToolUse` hook. Each is turned off with `off`, `0`, or `false` in the `env` block of a
`.claude/settings.json`. `code-ops-docs/50 Platform/INFRASTRUCTURE.md` owns those switches,
and `code-ops-docs/55 Operations/MEASUREMENTS.md` owns what they measure.

## Notes

- The skills work on any stack. They detect the tooling themselves and match the
  repository's own conventions.
- Optional tools, meaning documentation lookup, version-control history, a browser or UI
  tool, and read-only network or proxy inspection, are used when connected and skipped
  otherwise.
- Skills never emit a real identifier, IP address, or user data. Analysis works from
  redacted samples and patterns.
- The plugin pairs with the general-purpose `code-ops-suite` plugin. Use that one for broad
  engineering work, and this one for the anonymity and opsec specialization.
