// The single registry of the doctrine passages the repository pins on purpose.
//
// Each entry names a CORE span (a clause or sentence, free of per-plugin section references) and
// every file that must carry it byte-identically. Rolling out a doctrine change means editing every
// listed copy in the same commit; lint check 14 fails a partial rollout.
//
// Readers (never copies of this data):
//   - scripts/lint-plugins.mjs       check 14 (drift gate) and check 7 (the DUP_NGRAM copy rule)
//   - evals/lint-plugins/run.mjs     the fixture baseline seeds its CONVENTIONS files from it
//   - scripts/check-duplication.mjs  classifies a duplicated word run as pinned or unpinned
//
// Data and two pure helpers only, so a fixture can copy it beside lint-plugins.mjs.

import { conventionsRel } from './layout-manifest.mjs';

// Lint check 7 flags a run of this many words a skill shares verbatim with its CONVENTIONS.
export const DUP_NGRAM = 40;

// Lowercased alphanumeric word list, so a run compares across punctuation, case, and wrapping.
export const normWords = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

const CONVS = (...names) => names.map(conventionsRel);
export const SHARED_PASSAGES = [
  { id: 'fanout-throttle', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "A broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run. Do not rely on the platform's concurrency cap as the limiter" },
  { id: 'skim-then-deepen', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end' },
  { id: 'skipped-set', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: "take the union of every slice's skipped/traced note. A high-risk area that no slice covered is itself a finding (a coverage gap), not silence" },
  { id: 'intent-annotation', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: "read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior" },
  { id: 'locate-the-handler', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'must actively LOCATE the would-be handler (the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement)' },
  { id: 'headless-default', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'do not block: auto-scope from the repo, proceed on the safe default' },
  { id: 'headless-defer', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'are deferred and reported, never silently applied. Surface every decision and critical finding in the final report instead of pausing' },
  { id: 'circuit-breaker-core', files: CONVS('code-ops-suite', 'rigor'),
    text: 'stop the fix loop. A cascading cluster is evidence of an architectural problem, not a bug collection' },
  { id: 'circuit-breaker-checkpoint', files: CONVS('code-ops-suite', 'rigor'),
    text: 'present options at a checkpoint instead of attempting the next fix. In a headless run, defer the remaining cluster and report it' },
  { id: 'non-secret-anchor', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value). If no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.' },
  { id: 'terminal-forms', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'A consumed item ends in exactly one pinned terminal form (`closed-with-proof <commit/PR>`, `deferred-with-reason <reason>`, or `OBSOLETE-AT <sha>`) and never silently disappears' },
  { id: 'read-once', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it' },
  { id: 'prefilter-first', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full' },
  { id: 'repanel-skip', files: CONVS('code-ops-suite', 'rigor'),
    text: 'is NOT re-paneled. The receipts are the verdict, and any drift forces a fresh panel. Hand each panelist the finding block under test plus the cited region (anchor ±30 lines) inline, never the full register' },
  { id: 'map-once', files: CONVS('code-ops-suite', 'rigor'),
    text: 'hand the verified context artifact to every operative brief. Operatives consult it first and use search only to go deeper than it reaches, never to re-derive layout or find definitions it already lists' },
  { id: 'always-gated-core', files: ['plugins/code-ops-suite/CONVENTIONS.md', 'plugins/code-ops-suite/skills/everything/SKILL.md'],
    text: '**Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge' },
  { id: 'operative-failure', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "failed dispatch, not a weak signal. Never synthesize around a missing report or fill its gap from the orchestrator's own assumptions" },
  { id: 'failure-ladder', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'redispatch once with a tightened, smaller brief. Then escalate at the next checkpoint' },
  { id: 'ledger-atomicity', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'The row is written **at dispatch time**, atomically with the dispatch call itself, never a turn earlier or later, because a row written before its dispatch is a phantom indistinguishable from a hung operative' },
  { id: 'report-persistence', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "Every operative report lands as a file in the run's artifact folder, at the exact path its brief names. That path governs over any default reporting instruction in the agent definition. An operative with a file-write tool writes its full report to that path and returns only a pointer: the path, a one-line verdict, and counts. The lead verifies that file through the shape gate and never re-emits its body. It reads the body only when synthesis needs it. An operative without a write tool returns its report inline. The lead writes that report to the named path in the turn it arrives, before any other work. A report that exists only in the conversation is one blocked turn away from being lost." },
  { id: 'report-shape-gate', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'A brief that never reached its operative is indistinguishable in the dispatch record from a completed dispatch until the report is read. Gate every report on shape (expected sections present, non-empty, evidence attached) before its unit counts as covered. A pointed-to report file that is missing, empty, or malformed fails that gate exactly as a malformed inline report does.' },
  { id: 'tier-boundary', files: CONVS('code-ops-suite', 'rigor'),
    text: "an operative labels a finding CONFIRMED only when an executed repro or trace appears in its own transcript. A finding argued from static reading caps at PROBABLE, and promotion to CONFIRMED is the lead's act on executed evidence" },
  { id: 'panel-lens-diversity', files: CONVS('code-ops-suite', 'rigor'),
    text: "Panelists get **distinct lenses** (correctness, configuration-reading, reachability), never N identical skeptics. Identical readers repeat one another's misreads, and diversity catches what redundancy cannot." },
  { id: 'tier-floor-carrier', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'On a host that ignores agent `model:` frontmatter the lead acknowledges that printed floor table and routes every dispatch at or above its floor by hand. A below-floor dispatch is a doctrine violation that `run-cost-audit` records as a `tier-routing` FAIL.' },
  { id: 'last-paragraph-check', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Before ending a turn, read the last paragraph: if it is a plan, an unasked question, or a promise of work not yet done, do that work now.' },
  { id: 'touch-improve', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'Apply the touch-improve rule: leave every file the change touches better in modularity, performance, and quality. Fix any defect, slow path, or standards violation you find in touched code, in the same change. Name each fix in the unit report. Report as a follow-up any problem outside the touched files. Report as a follow-up any fix that changes what the task does not name: a public contract, data handling, or user-visible behavior. When unsure, confirm with the developer first (§3). A touched file that ends worse in modularity, performance, or quality needs a stated reason in the report.' },
  { id: 'ordered-objective', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'The objective is ordered: correctness and the safety floor, then module boundaries, then measured performance on hot paths, then readability, then size. Fewer lines wins only between candidates equal on the first four.' },
  { id: 'ladder-core', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: "Before writing code, climb the ladder in order: does it need to exist (scope is the request), does it exist here (search before you write), does the standard library, the platform, or an installed dependency do it (verified against current docs, never from memory), does it fit inside the owning module (extend before you add a file), and is there evidence to extract (a second caller, a unit that needs its own test, or a file past the repository's own size norm). Then write the minimum edge-case-correct implementation." },
  { id: 'writing-standard-core', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Write to the house writing standard: one term per concept, active voice, one instruction per sentence, 20 words for instructions and 25 for explanation. Identifiers, paths, commands, and quoted output count as one word and are never reworded to fit a limit.' },
  { id: 'reply-links', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "Every reply to the operator links each repository file, run folder, open-item pointer, and PR it names. A skill's final report is a reply. Write a file as `[name](repo-relative/path:line)` and a PR as its full URL. A bare `#123` is never enough. Artifacts keep backticked `file:line` citations with anchors, because the checkers parse them." },
  { id: 'code-standard-core', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "Design every change before writing it, sized to the change. Write the smallest correct, readable solution, and abstract only on evidence. Choose efficient algorithms, and measure before micro-optimizing. Comment reasons, never narration. Follow the language's style and the repository's toolchain. Test and review in proportion to risk. Never repeat a check whose input has not changed. Leave what you change in a better state than you found it. Improve its modularity, its performance, and its quality, and keep that improvement inside the change." },
];

// Same drift gate as SHARED_PASSAGES, but for the operative agent definitions
// (plugins/*/agents/*.md) rather than CONVENTIONS.md. They carry their own near-identical
// doctrine clauses (escalate-don't-guess, redact-secrets, dense/evidence-cited-report) with no
// other mechanical backstop.
const AGENTS = (...paths) => paths;
export const AGENT_SHARED_PASSAGES = [
  { id: 'agent-escalate-dont-guess', files: AGENTS(
      'plugins/code-ops-suite/agents/mech.md', 'plugins/code-ops-suite/agents/mech-review.md',
      'plugins/code-ops-suite/agents/explorer.md', 'plugins/code-ops-suite/agents/reviewer.md', 'plugins/code-ops-suite/agents/implementer.md',
      'plugins/code-ops-suite/agents/web-researcher.md', 'plugins/code-ops-suite/agents/probe.md',
      'plugins/privacy-opsec-suite/agents/explorer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/researcher/agents/claim-checker.md', 'plugins/researcher/agents/gatherer.md',
      'plugins/rigor/agents/tracer.md', 'plugins/rigor/agents/verifier.md'),
    text: 'return the open question to the orchestrator instead of guessing' },
  { id: 'agent-redact-secrets-full', files: AGENTS(
      'plugins/code-ops-suite/agents/explorer.md', 'plugins/code-ops-suite/agents/web-researcher.md', 'plugins/code-ops-suite/agents/probe.md',
      'plugins/researcher/agents/claim-checker.md',
      'plugins/researcher/agents/gatherer.md', 'plugins/rigor/agents/tracer.md'),
    text: 'Redact any secrets/PII to `<REDACTED:reason>`. Never reproduce a secret value.' },
  { id: 'agent-redact-secrets-short', files: AGENTS(
      'plugins/code-ops-suite/agents/mech.md', 'plugins/code-ops-suite/agents/mech-review.md',
      'plugins/code-ops-suite/agents/reviewer.md', 'plugins/code-ops-suite/agents/implementer.md', 'plugins/rigor/agents/verifier.md'),
    text: 'Redact secrets/PII.' },
  { id: 'agent-dense-evidence-cited', files: AGENTS(
      'plugins/code-ops-suite/agents/mech-review.md', 'plugins/code-ops-suite/agents/web-researcher.md', 'plugins/code-ops-suite/agents/probe.md',
      'plugins/code-ops-suite/agents/reviewer.md', 'plugins/code-ops-suite/agents/implementer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/researcher/agents/claim-checker.md', 'plugins/rigor/agents/verifier.md', 'plugins/rigor/agents/tracer.md'),
    text: 'dense and evidence-cited' },
  { id: 'agent-batch-tool-calls', files: AGENTS(
      'plugins/code-ops-suite/agents/mech.md', 'plugins/code-ops-suite/agents/mech-review.md',
      'plugins/code-ops-suite/agents/explorer.md', 'plugins/code-ops-suite/agents/reviewer.md', 'plugins/code-ops-suite/agents/implementer.md',
      'plugins/code-ops-suite/agents/web-researcher.md', 'plugins/code-ops-suite/agents/probe.md',
      'plugins/privacy-opsec-suite/agents/explorer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/researcher/agents/claim-checker.md', 'plugins/researcher/agents/gatherer.md',
      'plugins/rigor/agents/tracer.md', 'plugins/rigor/agents/verifier.md'),
    text: 'Before each tool round, list what you still need, then request every item that does not depend on another result in that one response.' },
  { id: 'agent-tier-boundary', files: AGENTS(
      'plugins/code-ops-suite/agents/reviewer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/rigor/agents/tracer.md', 'plugins/rigor/agents/verifier.md'),
    text: "label a finding CONFIRMED only when an executed repro or trace appears in your own transcript. A finding argued from static reading caps at PROBABLE, and promoting it is the orchestrator's call" },
];
