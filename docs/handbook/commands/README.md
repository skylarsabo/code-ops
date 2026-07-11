# Command Reference — Index & Task Router

The code-ops marketplace ships **56 commands** across four plugins. Every command is a
manual-invoke workflow: call it as `/<plugin>:<skill>` in Claude Code, or name
`<plugin>:<skill>` in a Codex request. They never auto-fire, because each is a deliberate operation. This page is the front door: it tells you how to
read a command entry, maps the goal you actually have to the command(s) that serve it in
the right order, and points you at the per-plugin reference for full detail.

If you are new, read the [getting-started guide](../01-getting-started.md) and the
[mental model](../02-mental-model.md) first; if you already know the four plugins, jump
straight to the [router table](#the-task--command-router) below.

> The four plugins, one line each:
> - **code-ops-suite** — the spine: broad engineering for any repo plus reference-doc generators plus the cross-cutting orchestrators.
> - **rigor** — the verification layer: prove it or do not report it; evidence tiers, a disconfirmation pass, runnable repros, enforced closure.
> - **privacy-opsec-suite** — the anonymity track: threat model, parallel leak audits, fail-closed hardening, and PR/authorship gates (only for projects with anonymity/opsec needs).
> - **researcher** — the proposal layer: code-grounded, local-first research with disclosed/fail-closed egress; it proposes and hands off, never edits code.

---

## How to read a command entry

Each per-plugin reference describes a command with the same fixed shape, so you can scan
any one of them the same way:

| Field | What it tells you |
| --- | --- |
| **Invoke** | The exact workflow name; Claude Code uses `/code-ops-suite:codebase-audit`, Codex uses `code-ops-suite:codebase-audit`. |
| **One-liner** | The single sentence from the plugin's own `README.md` Skills list. |
| **Mode** | The operating mode the skill declares (AUDIT, IMPLEMENT/writes code, DISCOVERY, REVIEW, DOCUMENT). DISCOVERY/REVIEW/DOCUMENT never edit source. |
| **Produces** | The real artifacts it writes — registers (`FINDINGS_REGISTER.md`, `LEAK_REGISTER.md`, `RESEARCH_FINDINGS.md`, `IDEAS_REGISTER.md`), threat models, design briefs, logs, or a verdict. |
| **Checkpoints** | Where it pauses for you. Every command is developer-in-the-loop; orchestrators pause at each phase boundary. |
| **Composes / hands off to** | Which other commands it calls or feeds, so chains are explicit. |
| **Conventions** | The `CONVENTIONS.md` section(s) it reads first (each plugin bundles its own at the plugin root). |

This shape mirrors the generated host-specific `SKILL.md` header each command carries: a `description`, a manual-invocation policy, and a `Mode · Produces` line. Claude Code's source uses `disable-model-invocation: true`; Codex renders `name` plus `agents/openai.yaml` with `allow_implicit_invocation: false`. What you read in the reference is what the skill declares about itself — not a paraphrase.

A few conventions hold for **every** command in every plugin (the shared backbone — see
[the mental model](../02-mental-model.md)):

- **Developer-in-the-loop.** Nothing irreversible happens without your say-so at a checkpoint.
- **Evidence at `file:line`.** Findings cite their location; claims name a source and a tier.
- **Behavior-preserving.** Changes preserve observable behavior unless you approve otherwise.
- **Registers are the single source of truth**, stamped `Verified-at <sha>`; the bundled
  `revalidate-register.mjs` re-checks freshness against the current tree before any hand-off.
- **The automation ladder** — gated / auto-safe / auto-all — with always-gated categories
  (security/auth, secrets, data migrations, public contracts, destructive ops). See
  [choosing an automation level](../../techniques/choosing-an-automation-level.md).

---

## The task → command router

Find the row that matches what you want. The **Run** column lists real command names in
the order to run them; `→` means "then", `+` means "in parallel / both", and `(orchestrator)`
marks a single command that strings the others together for you.

| I want to… | Run (in order) | Plugin(s) | Notes |
| --- | --- | --- | --- |
| **Audit an unfamiliar or drifting codebase** (breadth) | `/code-ops-suite:codebase-audit` → `/code-ops-suite:remediation` → `/code-ops-suite:pr-review` | code-ops-suite | Broad multi-lens review → fix the backlog → gate the diff. Writes `FINDINGS_REGISTER.md`. |
| **Audit a risky subsystem and trust the result** (depth + proof) | `/rigor:ground-truth` → `/rigor:test-suite-audit` → `/rigor:bug-hunt` + `/rigor:quality-scan` → `/rigor:safety-net` → `/rigor:fix-verified` | rigor | The verification journey. See [audit-a-risky-subsystem](../../guides/audit-a-risky-subsystem.md). |
| **Prove a bug is real (not just asserted)** | `/rigor:ground-truth` → `/rigor:bug-hunt` | rigor | Only `CONFIRMED` (reproduced) findings drive fixes. Read [evidence and tiers](../05-evidence-and-tiers.md). |
| **Find when a bug was introduced** | `/rigor:regression-hunt` | rigor | VCS-bisects a confirmed bug to its origin commit and sweeps recent changes. |
| **Fix a confirmed bug at root cause** | `/rigor:fix-verified` | rigor | Failing→passing regression test, regression guard, sibling sweep, enforcement. |
| **Drive a bug from symptom to proven fix** | `/code-ops-suite:debug` (orchestrator) | code-ops-suite (+ rigor) | reproduce → isolate → confirm cause → `rigor:fix-verified` → traceless PR. Requires `rigor`. |
| **Ship one change end-to-end at full rigor** | `/code-ops-suite:ship` (orchestrator) | code-ops-suite (+ rigor, privacy) | design-check → safety-net → implement → prove → privacy-gate → traceless PR. See [ship-a-verified-fix](../../guides/ship-a-verified-fix.md). |
| **Build a feature from scratch** | `/code-ops-suite:feature-discovery` → `/code-ops-suite:feature-implementation` → `/code-ops-suite:pr-review` | code-ops-suite | Discover + spec grounded features → build smallest slice behind flags → gate. |
| **Make something measurably faster** | `/rigor:ground-truth` → `/code-ops-suite:performance` | code-ops-suite (+ rigor) | Optimize only what is proven hot; prove it with before/after numbers. `/rigor:improve-measured` for measured deltas. |
| **Add meaningful test coverage** | `/rigor:ground-truth` → `/rigor:test-suite-audit` → `/code-ops-suite:test-hardening` | code-ops-suite (+ rigor) | Validate the suite (mutation/flaky) first, then harden critical paths. |
| **Pin behavior before a refactor** | `/rigor:safety-net` | rigor | Characterization tests lock observable behavior on blind spots first. |
| **Upgrade dependencies / clear CVEs safely** | `/code-ops-suite:dependency-upgrade` | code-ops-suite | Staged upgrades, never bulk-bumps. Pair with `researcher:ecosystem-watch`. |
| **Review a PR before merge** (breadth) | `/code-ops-suite:pr-review` | code-ops-suite | Rigorous pre-merge review across all lenses; prioritized comments + verdict. |
| **Review a PR at the verification bar** (depth) | `/rigor:deep-review` | rigor | Blocks only on `CONFIRMED` defects/regressions. The high-signal counterpart to `pr-review`. |
| **Normalize a repo to one consistent style** | `/code-ops-suite:normalize` | code-ops-suite | Behavior-preserving; removes the artifacts of hasty/generated code. |
| **Split a big branch into clean small PRs** | `/code-ops-suite:pr-split` | code-ops-suite (+ privacy) | Composes `privacy-opsec-suite:authorship-hygiene` (fail-closed); never auto-merges. |
| **Hand a long run to a fresh session** | `/code-ops-suite:handoff` | code-ops-suite | Write verifiable state (decisions, dead ends, anchored pointers) before a context limit; Resume re-verifies every claim before continuing. |
| **Close an inconsistency so it cannot return** | `/rigor:consistency-closure` | rigor | Pick a canonical form, migrate every site, add a lint/test enforcement. |
| **Model how a user could be deanonymized** | `/privacy-opsec-suite:anonymity-threat-model` | privacy-opsec-suite | The keystone artifact every leak audit frames against. |
| **Find anonymity leaks across the surface** | `/privacy-opsec-suite:anonymity-threat-model` → `/privacy-opsec-suite:tor-egress-audit` + `/privacy-opsec-suite:metadata-leak-audit` + `/privacy-opsec-suite:anon-session-audit` + `/privacy-opsec-suite:fingerprint-resistance` + `/privacy-opsec-suite:traffic-analysis-resistance` + `/privacy-opsec-suite:supply-chain-trust` | privacy-opsec-suite | The six parallel leak audits → `LEAK_REGISTER.md`. |
| **Harden the leaks I found** | `/privacy-opsec-suite:opsec-hardening` | privacy-opsec-suite | Implements the leak backlog; each leak gets a regression test, fail-closed. |
| **Respond to a suspected leak** | `/privacy-opsec-suite:leak-incident-response` → `/privacy-opsec-suite:opsec-hardening` | privacy-opsec-suite | Triage, contain, scope blast radius, plan remediation — without making it worse. |
| **Design a privacy/trust feature** | `/privacy-opsec-suite:privacy-feature-design` → `/code-ops-suite:feature-implementation` | privacy-opsec-suite (+ code-ops-suite) | Each feature gated against the anonymity model. |
| **Run the whole anonymity track** | `/privacy-opsec-suite:full-sweep` (orchestrator) | privacy-opsec-suite | model → audits → harden → docs/gate, pausing at each phase boundary. |
| **Choose a library / decide "adopt X?"** | `/researcher:library-eval` → `/code-ops-suite:adr` | researcher (+ code-ops-suite) | A-vs-B-vs-build grounded in your code and sources; record the decision as an ADR. |
| **Research an approach before building** | `/researcher:research-spike` → `/code-ops-suite:feature-implementation` | researcher (+ code-ops-suite) | Cited design brief + recommendation; hands off to implementation or `ship`. |
| **Gather grounded improvement ideas** | `/researcher:research-improve` → `/code-ops-suite:remediation` | researcher (+ code-ops-suite) | External best practices grounded in your code → `RESEARCH_FINDINGS.md`. |
| **Generate net-new feature ideas** | `/researcher:research-ideate` → `/code-ops-suite:feature-discovery` | researcher (+ code-ops-suite) | Code + domain + (opt-in) trends → `IDEAS_REGISTER.md` with a smallest valuable slice. |
| **Fact-check a claim or proposed approach** | `/researcher:research-verify` | researcher | Adversarial claim-check against sources and your code; tiers the verdict. Gates other research output. |
| **Watch the ecosystem for what changed** | `/researcher:ecosystem-watch` → `/code-ops-suite:dependency-upgrade` | researcher (+ code-ops-suite, privacy) | Updates, CVEs, deprecations, new capabilities; schedulable. Also composes `privacy-opsec-suite:supply-chain-trust`. |
| **Run the whole research pipeline** | `/researcher:research-sweep` (orchestrator) | researcher | ground → gather → verify → propose, surfacing the egress manifest at every checkpoint. |
| **Generate an architecture reference** | `/code-ops-suite:architecture` | code-ops-suite | C4 structure + critical-path sequence flows + key decisions, code-grounded. |
| **Generate an API/interface reference** | `/code-ops-suite:api-docs` | code-ops-suite | Endpoints/exports, signatures, request/response shapes, auth, errors, examples. |
| **Generate a data-model reference** | `/code-ops-suite:data-model` | code-ops-suite | ER diagram + per-entity fields, relationships, constraints, invariants. |
| **Record an architecture decision** | `/code-ops-suite:adr` | code-ops-suite | Backfill load-bearing past decisions or author a new one (context/options/decision/consequences). |
| **Generate an operator's runbook** | `/code-ops-suite:ops-docs` | code-ops-suite | Deploy/rollback, config reference, incident runbooks, health/observability. |
| **Onboard onto a codebase** | `/code-ops-suite:onboarding` | code-ops-suite | Verified, code-grounded orientation guide with an architecture diagram. |
| **Reconcile docs against the code** | `/code-ops-suite:doc-alignment` | code-ops-suite | Establish a clean single source of truth; fixes doc drift. (`/privacy-opsec-suite:privacy-doc-alignment` reconciles privacy/anonymity promises.) |
| **Get version-accurate docs for a dependency** | `/code-ops-suite:current-docs` | code-ops-suite | Local-first, no third-party — the in-house Context7 alternative (also the `code-ops-docs` MCP). |
| **Threat-model the attack surface** | `/code-ops-suite:security-privacy-audit` | code-ops-suite | Adversarial STRIDE + LINDDUN; writes `THREAT_MODEL.md` + findings. |
| **Run the full intra-suite engineering pass** | `/code-ops-suite:full-sweep` (orchestrator) | code-ops-suite | scope → ground truth → assess → safety-net → fix → deep-dives → consistency → document → ship. |
| **Run the most thorough cross-plugin pass** | `/code-ops-suite:everything` (orchestrator) | all three (code-ops-suite, rigor, privacy) | map → ground-truth → prove → leak-audit → safety-net → review → remediate → close → improve → normalize-and-document → verify-and-ship. Requires `rigor` and `privacy-opsec-suite`. See [the-everything-pass](../../guides/the-everything-pass.md). |
| **Run the rigor pipeline end-to-end** | `/rigor:rigor-sweep` (orchestrator) | rigor | Start with `assess-only` to get proven findings before changing anything. |
| **Wire a breadth PR gate into CI** | `/code-ops-suite:pr-review` in CI | code-ops-suite | Via `anthropics/claude-code-action@v1`; canonical setup is `/install-github-app`, then paste the review criteria. See `plugins/code-ops-suite/examples/github-pr-review.yml`. |
| **Wire a verification PR gate into CI** | `/rigor:deep-review` in CI | rigor | Same action; see `plugins/rigor/examples/github-deep-review.yml`. |
| **Wire an anonymity PR gate into CI** | `/privacy-opsec-suite:opsec-pr-gate` in CI | privacy-opsec-suite | Blocks any change adding egress/logging/identifiers/fingerprint/correlation/weakened defaults. See `plugins/privacy-opsec-suite/examples/github-opsec-gate.yml`. Also guards the researcher's egress posture. |
| **Scrub AI/tooling trace before publishing** | `/privacy-opsec-suite:authorship-hygiene` | privacy-opsec-suite | Metadata, prose voice, code idiom (bundled `scan-ai-tells.mjs`); fail-closed before publish. |

> Composition rule of thumb: **researcher proposes → code-ops-suite builds → rigor proves
> → privacy gates.** When in doubt, start broad (code-ops-suite) and reach for `rigor` when
> you need proof, `privacy-opsec-suite` when the project has anonymity needs, and
> `researcher` when the answer requires knowledge from outside the repo. The orchestrators
> in [chapter 03](../03-orchestrators.md) sequence these for you.

---

## Per-plugin command references

Full entries for every command, grouped by plugin and in invocation order:

- [code-ops-suite.md](code-ops-suite.md) — **24 commands**: the engineering spine (assess, build, deep-dives, gate/consistency, docs/knowledge, the documentation generators, and the orchestrators `full-sweep` / `everything` / `ship` / `debug`).
- [rigor.md](rigor.md) — **11 commands**: the verification layer (`ground-truth`, `test-suite-audit`, `safety-net`, `bug-hunt`, `regression-hunt`, `quality-scan`, `consistency-closure`, `improve-measured`, `fix-verified`, `deep-review`, `rigor-sweep`).
- [privacy-opsec-suite.md](privacy-opsec-suite.md) — **14 commands**: the anonymity track (the threat model, the six leak audits, `opsec-hardening`, `privacy-feature-design`, `leak-incident-response`, `authorship-hygiene`, `privacy-doc-alignment`, `opsec-pr-gate`, `full-sweep`).
- [researcher.md](researcher.md) — **7 commands**: the proposal layer (`research-spike`, `research-improve`, `research-ideate`, `ecosystem-watch`, `research-verify`, `library-eval`, `research-sweep`).

For the concepts the commands assume, see
[registers and freshness](../04-registers-and-freshness.md) and
[evidence and tiers](../05-evidence-and-tiers.md); for when to reach for an orchestrator,
[chapter 03](../03-orchestrators.md).

*Verified-at: b22d0da*
