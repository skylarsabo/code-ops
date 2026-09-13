---
name: provider-parity-audit
description: "Use when the marketplace must be audited across Claude, Codex, installed Grok, and OpenCode for host-specific assumptions in hooks, agents, skills, scripts, settings, manifests, generated projections, and documentation."
---

# Provider parity audit: one outcome across supported hosts

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:provider-parity-audit`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin, especially the finding and fix
tracks (`§6`) and finding schema (`§7`).
**Mode:** ASSESS · **Consumes:** canonical plugins, both generated host distributions,
repository and global contracts, host settings, evals, and installed-host evidence ·
**Produces:** `FINDINGS_REGISTER.md`.

Parity means an equivalent documented outcome through each host's supported API. It does not
mean byte-identical packaging or invented support for an event a host does not expose. Audit
Claude, Codex, installed Grok, and OpenCode as four separate capability profiles.

## Phase 0: bind the hosts and scope

Record the repository revision, installed host versions, applicable global and repository
contracts, plugin versions, and generated-distribution versions. Treat a missing host binary as
`UNAVAILABLE`, not as a passing result.

The audit scope includes:

- `plugins/*/hooks/`, `agents/`, `skills/`, `scripts/`, manifests, `CONVENTIONS.md`, and READMEs;
- `scripts/build-codex-marketplace.mjs` and `scripts/build-opencode-dist.mjs`;
- `codex-marketplace/`, `.agents/`, and `opencode-dist/` as generated evidence, never edit targets;
- root and global contracts, host settings, documentation, and evals;
- digest, index, ladder, receipt, compaction, routing, and model-floor mechanisms.

Dispatch disjoint inventory units when the graph permits: canonical behavior, Codex projection,
OpenCode projection, and installed Grok evidence. Each unit returns only `file:line` evidence,
commands run, unavailable surfaces, and confidence.

## Phase 1: establish mechanical ground truth

Run both renderer checks and their focused evals:

```text
node scripts/build-codex-marketplace.mjs --check
node scripts/build-opencode-dist.mjs --check
node evals/codex-marketplace/run.mjs
node evals/opencode-dist/run.mjs
```

Run `node evals/grok-build-compat/run.mjs`. When the installed Grok binary is available, also
run `grok --version`, `grok plugin validate .`, and `grok plugin validate` for each canonical
plugin directory.

Read the installed Grok hook guide at `~/.grok/docs/user-guide/10-hooks.md` and record its
runtime version. Validate command-hook output shapes and side effects directly, but distinguish
those probes from a live external model turn. Do not claim live-turn proof unless that turn was
actually run and its authority and non-secret evidence are recorded.

Inspect OpenCode's generated plugin implementation and compatibility page against the installed
or current primary plugin API. Confirm traceless publishing, model floors, digest input mutation,
index refresh, routing, compaction, and MCP behavior. Record ladder and transcript-receipt
callbacks as unsupported when the API still lacks them.

## Phase 2: trace capability outcomes

For every hook, agent, skill, script, setting, and documented workflow, build one row per host:

| Field | Required value |
| --- | --- |
| Host | Claude, Codex, Grok, or OpenCode |
| Surface | Exact canonical or generated path |
| Capability | User-visible outcome being tested |
| Mechanism | Native, rendered, instruction-file fallback, MCP fallback, or unavailable |
| Evidence | `file:line`, command result, installed guide, or runtime receipt |
| State | SUPPORTED, FALLBACK, UNAVAILABLE, BROKEN, or UNVERIFIED |

Trace through wrappers and generated files instead of stopping at the canonical declaration.
Do not call a hook portable until the host accepts its event, input shape, output shape, and
side effect. Do not call a script portable until its paths, tool names, shell rules, and invoked
dependencies work on that host.

Use cross-host-safe examples. Say "shell command" unless a literal host tool name matters,
"host environment" unless a settings path is deliberately host-specific, and "operative"
unless the host API itself names a subagent. A provider-specific example names its host and the
equivalent or limitation on the other hosts.

## Phase 3: classify every divergence

Classify each hit as exactly one of these:

- **Host-neutral and supported.** The same prose and behavior are correct on all four hosts.
- **Renderer-reconciled.** A Codex or OpenCode renderer deliberately translates canonical
  source, and the generated check proves the current projection.
- **Native-host compatible.** Claude or installed Grok consumes the canonical package directly,
  with direct validation or runtime evidence.
- **Documented fallback.** The host lacks the primary API, but instruction files, MCP, or another
  tested mechanism provides the same outcome.
- **Intentional capability gap.** The host cannot provide the outcome. Documentation names the
  limit without implying support.
- **Needs generic rewording.** Behavior is portable, but prose incorrectly makes one host's
  filename, tool name, setting, or hook shape universal.
- **Broken parity.** A claimed supported or fallback outcome fails its renderer, validation,
  focused eval, direct probe, or implementation trace.

Do not accept a generated file merely because it exists. Do not flag a deliberate host-specific
contract when its scope and counterpart are explicit.

## Phase 4: findings and independent challenge

Write every needs-rewording, broken-parity, unverified critical surface, and undocumented gap to
`FINDINGS_REGISTER.md` using `§7`. Track a lexical, behavior-inert correction `NOW-SAFE`; track
mechanism, settings, security, or user-expectation changes `NEEDS-REVIEW`.

Record accepted renderer translations, fallbacks, and intentional gaps with their rationale so
a later pass does not re-flag them. Independently challenge every concrete broken-parity finding
against the host contract, wrapper, generated output, and focused eval before acceptance.

## Done when

- Claude, Codex, installed Grok, and OpenCode each have an explicit capability profile.
- Every in-scope hook, agent, skill, script family, settings contract, renderer, and documented
  workflow has a classification or a named coverage gap.
- Both renderer checks, both generated-distribution evals, and the Grok compatibility eval have
  a recorded verdict.
- Installed Grok validation and guide evidence are recorded when available; absence is
  `UNAVAILABLE` rather than silently skipped.
- Exact-output probes and live external-turn evidence are labeled separately.
- Every concrete finding survived an independent challenge.
- `FINDINGS_REGISTER.md` passes
  `node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .`.
- Needs-rewording and broken-parity items appear before accepted gaps and fallbacks.
