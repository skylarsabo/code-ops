#!/usr/bin/env node
// Regression eval for scripts/lint-plugins.mjs — the repo's main structural gate. It is
// normally only ever run against the live repo tree, so a regression that silently
// no-ops one of its checks (a loop that stops iterating, a condition inverted, a fail()
// turned into a warn()) is invisible unless the live repo happens to violate that exact
// rule right now. This eval spawns the real, unmodified script against small synthetic
// fixture trees and asserts it FAILS CLOSED on deliberately broken ones and stays clean
// on a minimal passing one.
//
// FIXTURE-DESIGN NOTE (read before editing): two of the linter's checks are NOT scoped to
// whatever plugins/skills a tree happens to register in marketplace.json — they hardcode
// paths relative to ROOT and check for them unconditionally, every run, regardless of what
// the marketplace declares:
//   - PRODUCER_SELFCHECK (its check 13) requires these 4 exact files to exist, each with a
//     "## Done when" section that mentions revalidate-register.mjs:
//       plugins/rigor/skills/{bug-hunt,quality-scan}/SKILL.md
//       plugins/code-ops-suite/skills/{normalize,codebase-audit}/SKILL.md
//     and PRODUCER_STRICT (same check) requires rigor's bug-hunt, quality-scan, and deep-review
//     Done-when to carry "revalidate-register.mjs --strict --profile finding-rigor", and
//     normalize's to carry "--strict --profile consistency --min-items 1".
//   - SHARED_PASSAGES (its check 14) requires — unconditionally, for every entry's `files`
//     list, regardless of whether that plugin is registered — CONVENTIONS.md to exist and
//     carry a pinned sentence verbatim at FOUR hardcoded plugin paths: code-ops-suite,
//     rigor, privacy-opsec-suite, researcher (~22 sentences shared across most of them),
//     plus 'always-gated-core' which ALSO requires
//     plugins/code-ops-suite/skills/everything/SKILL.md to exist and carry its sentence.
// Contrast: the agent-related checks (9/10/12, AGENT_MODEL_FLOORS included) and the
// per-skill handbook checks ARE properly conditional (an agents/ dir, a code-ops-docs/40 Engineering/Handbook/
// commands/ dir, a plugin's own skill list) and skip cleanly when a fixture omits them —
// verified by reading their `if (existsSync(...))` / `for (slug of p.skills)` guards in
// scripts/lint-plugins.mjs. PRODUCER_SELFCHECK and SHARED_PASSAGES have no such guard: they
// walk their hardcoded path lists regardless of what plugins.length is. Practical upshot: a
// fixture that only registers 2 plugins still needs plugins/privacy-opsec-suite/
// CONVENTIONS.md and plugins/researcher/CONVENTIONS.md to exist on disk (with the doctrine
// text) purely to satisfy SHARED_PASSAGES's existence check — which in turn means those two
// dirs must ALSO be registered marketplace entries (else the separate "unregistered plugin
// dir" check fires on them) and, since code-ops-docs/40 Engineering/Handbook/commands/ exists in this fixture, each
// needs a stub handbook page and a "**0 commands**" router bullet (0 skills each keeps every
// per-skill requirement moot). The PINNED_TEXTS/ALWAYS_GATED_TEXT constants below are
// transcribed verbatim from SHARED_PASSAGES in scripts/lint-plugins.mjs as of this writing.
// If that array's `text` values ever change, this eval's baseline case starts failing loudly
// (a mismatched pinned string is a missing substring) — that is the intended fail-closed
// behavior for a pinned-content fixture, not a bug in this eval; update PINNED_TEXTS/
// ALWAYS_GATED_TEXT to match.
//
//   node evals/lint-plugins/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const REAL_LINT = join(REPO, 'scripts', 'lint-plugins.mjs');
// The gate imports its model-tier ladder from this sibling. Copy the REAL file rather than
// a synthetic stand-in (unlike vendored-manifest.mjs below, whose contents the fixture must
// control): the agent-model-floor cases only mean something against the actual ladder.
const REAL_MODEL_TIERS = join(REPO, 'scripts', 'model-tiers.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };

// Spawn the real, unmodified script (copied into the fixture's own scripts/ dir, since it
// resolves its ROOT from its own file location one level up). Never a shell string.
const runLint = (dir) => {
  try {
    const out = execFileSync(process.execPath, [join(dir, 'scripts', 'lint-plugins.mjs')], { encoding: 'utf8', timeout: 15000, cwd: dir });
    return { status: 0, all: out };
  } catch (e) {
    return { status: e.status ?? 1, all: (e.stdout || '') + (e.stderr || '') };
  }
};

// ---- pinned doctrine text (SHARED_PASSAGES in scripts/lint-plugins.mjs) -----------------
const PINNED_TEXTS = [
  'The objective is ordered: correctness and the safety floor, then module boundaries, then measured performance on hot paths, then readability, then size. Fewer lines wins only between candidates equal on the first four.',
  "Before writing code, climb the ladder in order: does it need to exist (scope is the request), does it exist here (search before you write), does the standard library, the platform, or an installed dependency do it (verified against current docs, never from memory), does it fit inside the owning module (extend before you add a file), and is there evidence to extract (a second caller, a unit that needs its own test, or a file past the repository's own size norm). Then write the minimum edge-case-correct implementation.",
  "A broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run. Do not rely on the platform's concurrency cap as the limiter",
  'skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end',
  "take the union of every slice's skipped/traced note. A high-risk area that no slice covered is itself a finding (a coverage gap), not silence",
  "read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior",
  'must actively LOCATE the would-be handler (the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement)',
  'do not block: auto-scope from the repo, proceed on the safe default',
  'are deferred and reported, never silently applied. Surface every decision and critical finding in the final report instead of pausing',
  'stop the fix loop. A cascading cluster is evidence of an architectural problem, not a bug collection',
  'present options at a checkpoint instead of attempting the next fix. In a headless run, defer the remaining cluster and report it',
  'For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value). If no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.',
  'A consumed item ends in exactly one pinned terminal form (`closed-with-proof <commit/PR>`, `deferred-with-reason <reason>`, or `OBSOLETE-AT <sha>`) and never silently disappears',
  'Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it',
  'Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full',
  'is NOT re-paneled. The receipts are the verdict, and any drift forces a fresh panel. Hand each panelist the finding block under test plus the cited region (anchor ±30 lines) inline, never the full register',
  'hand the verified context artifact to every operative brief. Operatives consult it first and use search only to go deeper than it reaches, never to re-derive layout or find definitions it already lists',
  "failed dispatch, not a weak signal. Never synthesize around a missing report or fill its gap from the orchestrator's own assumptions",
  'redispatch once with a tightened, smaller brief. Then escalate at the next checkpoint',
  'The row is written **at dispatch time**, atomically with the dispatch call itself, never a turn earlier or later, because a row written before its dispatch is a phantom indistinguishable from a hung operative',
  "Every operative report lands as a file in the run's artifact folder, at the exact path its brief names. That path governs over any default reporting instruction in the agent definition. An operative with a file-write tool writes its full report to that path and returns only a pointer: the path, a one-line verdict, and counts. The lead verifies that file through the shape gate and never re-emits its body. It reads the body only when synthesis needs it. An operative without a write tool returns its report inline. The lead writes that report to the named path in the turn it arrives, before any other work. A report that exists only in the conversation is one blocked turn away from being lost.",
  'A brief that never reached its operative is indistinguishable in the dispatch record from a completed dispatch until the report is read. Gate every report on shape (expected sections present, non-empty, evidence attached) before its unit counts as covered. A pointed-to report file that is missing, empty, or malformed fails that gate exactly as a malformed inline report does.',
  "an operative labels a finding CONFIRMED only when an executed repro or trace appears in its own transcript. A finding argued from static reading caps at PROBABLE, and promotion to CONFIRMED is the lead's act on executed evidence",
  "Panelists get **distinct lenses** (correctness, configuration-reading, reachability), never N identical skeptics. Identical readers repeat one another's misreads, and diversity catches what redundancy cannot.",
  'On a host that ignores agent `model:` frontmatter the lead acknowledges that printed floor table and routes every dispatch at or above its floor by hand. A below-floor dispatch is a doctrine violation that `run-cost-audit` records as a `tier-routing` FAIL.',
  'Before ending a turn, read the last paragraph: if it is a plan, an unasked question, or a promise of work not yet done, do that work now.',
  'A pre-existing bug, performance concern, or behavior the task does not name is reported as a follow-up, never fixed, optimized, or extended in this change unless the requested behavior cannot work without it.',
  'Write to the house writing standard: one term per concept, active voice, one instruction per sentence, 20 words for instructions and 25 for explanation. Identifiers, paths, commands, and quoted output count as one word and are never reworded to fit a limit.',
  "Design every change before writing it, sized to the change. Write the smallest correct, readable solution, and abstract only on evidence. Choose efficient algorithms, and measure before micro-optimizing. Comment reasons, never narration. Follow the language's style and the repository's toolchain. Test and review in proportion to risk. Never repeat a check whose input has not changed.",
];
const ALWAYS_GATED_TEXT = '**Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge';
const DOCTRINE_BLOB = [...PINNED_TEXTS, ALWAYS_GATED_TEXT].join('\n\n');

// ---- fixture writer ----------------------------------------------------------------
const put = (root, relPath, content) => {
  const full = join(root, ...relPath.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

// Fixture descriptions name no repository-root path: check 24 reports a shipped citation of a
// file the plugin does not bundle, and a fixture plugin bundles no eval.
const skillBody = (title, { doneRevalidate = true, doneFlags = '--strict --profile finding-rigor', extra = '' } = {}) => `---
description: "Fixture skill for the lint-plugins regression eval."
---

# ${title} (FIXTURE)

Read the bundled CONVENTIONS.md first. Leave the rest of that file unread. This is fixture content; it is not a real skill.
${extra}
## Done when
The fixture task is complete${doneRevalidate ? ` and revalidate-register.mjs ${doneFlags} has been re-run clean` : ''}.
`;

// ---- fixture agents (AGENT_SHARED_PASSAGES, check 14's agents/*.md sibling in
// scripts/lint-plugins.mjs) — each bundled agent must exist with a frontmatter `model:`
// tier at or above its AGENT_MODEL_FLOORS entry, and carry whichever pinned doctrine
// clauses that agent's file path is listed under. Sentences below are transcribed
// verbatim from AGENT_SHARED_PASSAGES; if that array's `text` values ever change, this
// eval's baseline starts failing loudly — update these to match, same contract as
// PINNED_TEXTS/ALWAYS_GATED_TEXT above.
const AGENT_ESCALATE = 'If the question is ambiguous, return the open question to the orchestrator instead of guessing.';
const AGENT_REDACT_FULL = 'Redact any secrets/PII to `<REDACTED:reason>`. Never reproduce a secret value.';
const AGENT_REDACT_SHORT = 'Redact secrets/PII.';
const AGENT_DENSE_EVIDENCE = 'Reports must stay dense and evidence-cited, with no raw dumps.';
const AGENT_BATCH = 'Before each tool round, list what you still need, then request every item that does not depend on another result in that one response.';
const AGENT_TIER_BOUNDARY = "Tier at the evidence you have: label a finding CONFIRMED only when an executed repro or trace appears in your own transcript. A finding argued from static reading caps at PROBABLE, and promoting it is the orchestrator's call.";

// Every fixture agent carries a report cap line (lint check 25); cases 7b and 7c mutate it.
const AGENT_REPORT_CAP = 'Report cap: at most 400 words; return only the conclusion, evidence anchors, and next action.';
// Every fixture agent carries a check 26 contract; cases 15a-15d mutate it.
const FENCE = '```';
const agentContract = (edits = 'none') => `
## Contract

Brief requires: Scope, Objective, Round budget, Report cap, Expected return
Edits: ${edits}
Verdicts: ANSWERED | ESCALATE

${FENCE}text
ANSWERED: fixture answer with evidence anchors
${FENCE}
`;
const agentBody = (name, model, texts, cap = AGENT_REPORT_CAP, { tools = 'Read, Grep, Glob', contract = agentContract() } = {}) => `---
name: ${name}
description: "Fixture agent for the lint-plugins regression eval."
tools: ${tools}
model: ${model}
---

# ${name} (FIXTURE)

Fixture agent; not a real agent. Read-only investigation for the fixture task.

${texts.join('\n\n')}
${cap ? `\n${cap}\n` : ''}${contract}`;
const MECH_OPTS = { tools: 'Read, Edit, Write, Bash, Grep, Glob', contract: agentContract('scope') };

const FIXTURE_CONTRACT = '# Fixture standards contract\n\nStands in for the repo contract that AGENTS.md carries and CLAUDE.md imports.\n';

// Builds a MINIMAL tree that scripts/lint-plugins.mjs (copied in, unmodified) passes.
// Two plugins, named/shaped exactly as PRODUCER_SELFCHECK and SHARED_PASSAGES require
// (see the file header note) — 5 skills total, one vendored script, one handbook page
// per plugin plus the router index.
function buildBaseline(root) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(REAL_LINT, join(root, 'scripts', 'lint-plugins.mjs'));
  copyFileSync(REAL_MODEL_TIERS, join(root, 'scripts', 'model-tiers.mjs'));
  // The standards contract lives in AGENTS.md and CLAUDE.md is only its import line
  // (check 20). Cases 11 through 11f mutate one side each.
  put(root, 'CLAUDE.md', '@AGENTS.md\n');
  put(root, 'AGENTS.md', FIXTURE_CONTRACT);
  put(root, 'scripts/vendored-manifest.mjs', "export const RUNTIME_SCRIPTS = [\n  { name: 'fixture-tool.mjs', plugins: ['rigor'] },\n];\n");
  const fixtureTool = '// Fixture runtime script for evals/lint-plugins/run.mjs (vendored-script parity check).\nexport const FIXTURE_TOOL = true;\n';
  put(root, 'scripts/fixture-tool.mjs', fixtureTool);
  put(root, 'plugins/rigor/scripts/fixture-tool.mjs', fixtureTool); // byte-identical vendored copy

  put(root, '.claude-plugin/marketplace.json', JSON.stringify({
    plugins: [
      { name: 'code-ops-suite', source: './plugins/code-ops-suite', version: '0.1.0', description: 'fixture code-ops-suite plugin' },
      { name: 'rigor', source: './plugins/rigor', version: '0.1.0', description: 'fixture rigor plugin' },
      // Registered purely because SHARED_PASSAGES hardcodes their CONVENTIONS.md paths
      // unconditionally (see file header note) — 0 skills keeps every per-skill
      // requirement moot; only their CONVENTIONS.md content and bare registration matter.
      { name: 'privacy-opsec-suite', source: './plugins/privacy-opsec-suite', version: '0.1.0', description: 'fixture privacy-opsec-suite plugin (SHARED_PASSAGES filler)' },
      { name: 'researcher', source: './plugins/researcher', version: '0.1.0', description: 'fixture researcher plugin (SHARED_PASSAGES filler)' },
    ],
  }, null, 2));

  put(root, 'README.md', [
    '# Fixture Marketplace (evals/lint-plugins)',
    '',
    'Fixture root README for the scripts/lint-plugins.mjs regression eval.',
    '',
    '- **`code-ops-suite`** — fixture plugin. (3 skills)',
    '- **`rigor`** — fixture plugin. (3 skills)',
    '- **`privacy-opsec-suite`** — fixture filler plugin. (0 skills)',
    '- **`researcher`** — fixture filler plugin. (0 skills)',
    '',
  ].join('\n'));

  // -- code-ops-suite: codebase-audit and normalize (PRODUCER_SELFCHECK) + everything (SHARED_PASSAGES) --
  put(root, 'plugins/code-ops-suite/.claude-plugin/plugin.json', JSON.stringify({ name: 'code-ops-suite', version: '0.1.0', description: 'fixture code-ops-suite plugin' }, null, 2));
  put(root, 'plugins/code-ops-suite/CONVENTIONS.md', `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
  put(root, 'plugins/code-ops-suite/README.md', '# code-ops-suite (fixture)\n\nSkills: codebase-audit, normalize, everything.\n');
  put(root, 'plugins/code-ops-suite/skills/codebase-audit/SKILL.md', skillBody('CODEBASE AUDIT'));
  put(root, 'plugins/code-ops-suite/skills/normalize/SKILL.md', skillBody('NORMALIZE', { doneFlags: '--strict --profile consistency --min-items 1' }));
  put(root, 'plugins/code-ops-suite/skills/everything/SKILL.md', skillBody('EVERYTHING', {
    doneRevalidate: false,
    extra: `\n${ALWAYS_GATED_TEXT}** without explicit developer approval at a checkpoint.\n`,
  }));
  put(root, 'plugins/code-ops-suite/agents/explorer.md', agentBody('explorer', 'haiku', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_FULL]));
  put(root, 'plugins/code-ops-suite/agents/reviewer.md', agentBody('reviewer', 'opus', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_SHORT, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));
  put(root, 'plugins/code-ops-suite/agents/implementer.md', agentBody('implementer', 'opus', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_SHORT, AGENT_DENSE_EVIDENCE]));
  put(root, 'plugins/code-ops-suite/agents/mech.md', agentBody('mech', 'sonnet', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_SHORT], AGENT_REPORT_CAP, MECH_OPTS));
  put(root, 'plugins/code-ops-suite/agents/mech-review.md', agentBody('mech-review', 'sonnet', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_SHORT, AGENT_DENSE_EVIDENCE]));

  // -- rigor: bug-hunt, quality-scan (PRODUCER_SELFCHECK), deep-review (PRODUCER_STRICT) --
  put(root, 'plugins/rigor/.claude-plugin/plugin.json', JSON.stringify({ name: 'rigor', version: '0.1.0', description: 'fixture rigor plugin' }, null, 2));
  put(root, 'plugins/rigor/CONVENTIONS.md', `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
  put(root, 'plugins/rigor/README.md', '# rigor (fixture)\n\nSkills: bug-hunt, quality-scan, deep-review.\n');
  put(root, 'plugins/rigor/skills/bug-hunt/SKILL.md', skillBody('BUG HUNT'));
  put(root, 'plugins/rigor/skills/quality-scan/SKILL.md', skillBody('QUALITY SCAN'));
  put(root, 'plugins/rigor/skills/deep-review/SKILL.md', skillBody('DEEP REVIEW'));
  put(root, 'plugins/rigor/agents/tracer.md', agentBody('tracer', 'opus', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_FULL, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));
  put(root, 'plugins/rigor/agents/verifier.md', agentBody('verifier', 'opus', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_SHORT, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));

  // -- privacy-opsec-suite / researcher: bare SHARED_PASSAGES filler, 0 skills each --
  for (const filler of ['privacy-opsec-suite', 'researcher']) {
    put(root, `plugins/${filler}/.claude-plugin/plugin.json`, JSON.stringify({ name: filler, version: '0.1.0', description: `fixture ${filler} plugin (SHARED_PASSAGES filler)` }, null, 2));
    put(root, `plugins/${filler}/CONVENTIONS.md`, `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
    put(root, `plugins/${filler}/README.md`, `# ${filler} (fixture)\n\nNo skills — SHARED_PASSAGES filler only.\n`);
  }
  // -- privacy-opsec-suite / researcher agents (AGENT_SHARED_PASSAGES filler) --
  put(root, 'plugins/privacy-opsec-suite/agents/explorer.md', agentBody('explorer', 'haiku', [AGENT_BATCH, AGENT_ESCALATE]));
  put(root, 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md', agentBody('privacy-reviewer', 'opus', [AGENT_BATCH, AGENT_ESCALATE, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));
  put(root, 'plugins/researcher/agents/claim-checker.md', agentBody('claim-checker', 'sonnet', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_FULL, AGENT_DENSE_EVIDENCE]));
  put(root, 'plugins/researcher/agents/gatherer.md', agentBody('gatherer', 'haiku', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_FULL]));

  // -- handbook (router index + one page per plugin) --
  put(root, 'code-ops-docs/40 Engineering/Handbook/commands/README.md', [
    '# Command Reference (fixture)',
    '',
    'Fixture handbook index for evals/lint-plugins/run.mjs.',
    '',
    '## The task → command router',
    '',
    '| I want to… | Run | Plugin(s) | Notes |',
    '| --- | --- | --- | --- |',
    '| audit the fixture repo | `/code-ops-suite:codebase-audit` | code-ops-suite | fixture row |',
    '| close a fixture inconsistency | `/code-ops-suite:normalize` | code-ops-suite | fixture row |',
    '| run the fixture orchestrator | `/code-ops-suite:everything` | code-ops-suite | fixture row |',
    '| hunt fixture bugs | `/rigor:bug-hunt` | rigor | fixture row |',
    '| scan fixture quality | `/rigor:quality-scan` | rigor | fixture row |',
    '| review a fixture change | `/rigor:deep-review` | rigor | fixture row |',
    '',
    '## Per-plugin command references',
    '',
    '- [code-ops-suite.md](code-ops-suite.md) — **3 commands**: fixture.',
    '- [rigor.md](rigor.md) — **3 commands**: fixture.',
    '- [privacy-opsec-suite.md](privacy-opsec-suite.md) — **0 commands**: fixture filler.',
    '- [researcher.md](researcher.md) — **0 commands**: fixture filler.',
    '',
  ].join('\n'));
  for (const filler of ['privacy-opsec-suite', 'researcher']) {
    put(root, `code-ops-docs/40 Engineering/Handbook/commands/${filler}.md`, `# Command Reference — ${filler} (fixture)\n\nNo commands (fixture filler plugin with 0 skills).\n`);
  }
  put(root, 'code-ops-docs/40 Engineering/Handbook/commands/code-ops-suite.md', [
    '# Command Reference — code-ops-suite (fixture)',
    '',
    '### `/code-ops-suite:codebase-audit`',
    'Fixture entry.',
    '',
    '### `/code-ops-suite:normalize`',
    'Fixture entry.',
    '',
    '### `/code-ops-suite:everything`',
    'Fixture entry.',
    '',
  ].join('\n'));
  put(root, 'code-ops-docs/40 Engineering/Handbook/commands/rigor.md', [
    '# Command Reference — rigor (fixture)',
    '',
    '### `/rigor:bug-hunt`',
    'Fixture entry.',
    '',
    '### `/rigor:quality-scan`',
    'Fixture entry.',
    '',
    '### `/rigor:deep-review`',
    'Fixture entry.',
    '',
  ].join('\n'));

  // -- fixture eval + workflow wiring (check 18: eval-wired-to-CI) --
  put(root, 'evals/fixture-check/run.mjs', "// Fixture eval used only to be referenced by check 18 (evals-wired-to-CI) in scripts/lint-plugins.mjs.\nconsole.log('OK — fixture eval, always passes.');\n");
  put(root, '.github/workflows/validate.yml', [
    'name: validate (fixture)',
    'on: [push]',
    'jobs:',
    '  structural-lint:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Structural lint',
    '        run: node scripts/lint-plugins.mjs',
    '      - name: Fixture eval',
    '        run: node evals/fixture-check/run.mjs',
    '',
  ].join('\n'));
}

const work = mkdtempSync(join(tmpdir(), 'coh-lintp-'));
try {
  const baseline = join(work, 'baseline');
  buildBaseline(baseline);

  // 1. BASELINE — minimal passing tree: exit 0, banner names the exact counts.
  const r1 = runLint(baseline);
  check('1. baseline exits 0', r1.status === 0);
  check('1. baseline banner reports 4 plugins / 6 commands / 6 unique skills', r1.all.includes('OK — 4 plugins, 6 commands (6 unique skills)'));

  // Clone the baseline, apply one surgical mutation to the cloned file (never a wholesale
  // rewrite — that risks silently dropping unrelated baseline content), run, assert.
  const clone = (label) => { const d = join(work, label); cpSync(baseline, d, { recursive: true }); return d; };
  const readIn = (dir, relPath) => readFileSync(join(dir, ...relPath.split('/')), 'utf8');

  // 2. VERSION PARITY — marketplace version diverges from plugin.json version.
  const d2 = clone('case2-version-parity');
  const mp2 = JSON.parse(readIn(d2, '.claude-plugin/marketplace.json'));
  mp2.plugins.find((p) => p.name === 'rigor').version = '0.2.0'; // was 0.1.0, plugin.json stays 0.1.0
  put(d2, '.claude-plugin/marketplace.json', JSON.stringify(mp2, null, 2));
  const r2 = runLint(d2);
  check('2. version mismatch exits 1', r2.status === 1);
  check('2. message mentions the mismatch', r2.all.includes('version mismatch for "rigor"') && r2.all.includes('0.2.0') && r2.all.includes('0.1.0'));

  // 3. DONE-WHEN — remove "## Done when" from a skill (also a PRODUCER_SELFCHECK file,
  // so this legitimately trips two independent checks; both fail messages cite "Done when").
  const d3 = clone('case3-done-when');
  put(d3, 'plugins/rigor/skills/bug-hunt/SKILL.md', `---
description: "Fixture skill for the lint-plugins regression eval."
---

# BUG HUNT (FIXTURE)

Read the bundled CONVENTIONS.md first. Leave the rest of that file unread. This is fixture content; it is not a real skill.
No completion heading here on purpose (case 3 mutation).
`);
  const r3 = runLint(d3);
  check('3. missing Done when exits 1', r3.status === 1);
  check('3. message mentions "Done when"', r3.all.includes('Done when'));

  // 4. ROUTER COUNT — handbook "**N commands**" bullet set to a wrong N (rigor has 3 skills).
  const d4 = clone('case4-router-count');
  const readme4 = readIn(d4, 'code-ops-docs/40 Engineering/Handbook/commands/README.md');
  const mutated4 = readme4.replace('- [rigor.md](rigor.md) — **3 commands**: fixture.', '- [rigor.md](rigor.md) — **5 commands**: fixture.');
  check('4. setup: router-count mutation string found', mutated4 !== readme4);
  put(d4, 'code-ops-docs/40 Engineering/Handbook/commands/README.md', mutated4);
  const r4 = runLint(d4);
  check('4. wrong router count exits 1', r4.status === 1);
  check('4. message mentions the count', r4.all.includes('**5 commands**') && r4.all.includes('actually has 3'));

  // 5. VENDORED DRIFT — vendored copy diverges from the canonical script.
  const d5 = clone('case5-vendored-drift');
  put(d5, 'plugins/rigor/scripts/fixture-tool.mjs', '// Fixture runtime script for evals/lint-plugins/run.mjs (vendored-script parity check).\nexport const FIXTURE_TOOL = true;\n// drifted on purpose (case 5 mutation)\n');
  const r5 = runLint(d5);
  check('5. vendored drift exits 1', r5.status === 1);
  check('5. message mentions "drifted"', r5.all.includes('drifted'));

  // 5b. REVERSE VENDORED PARITY — an undeclared plugin-local script must not evade the
  // forward RUNTIME_SCRIPTS walk merely because no prompt references it.
  const d5b = clone('case5b-undeclared-vendored-script');
  put(d5b, 'plugins/rigor/scripts/hidden-tool.mjs', '// Undeclared vendored script (case 5b).\n');
  const r5b = runLint(d5b);
  check('5b. undeclared bundled script exits 1', r5b.status === 1);
  check('5b. message names reverse parity failure', r5b.all.includes('hidden-tool.mjs') && r5b.all.includes('not declared for this plugin'));

  // 5c-e. SCRIPT REFERENCE SURFACES — agent prompts, plugin README prose, and plugin.json
  // are runtime-owned package surfaces too. A missing helper reference on any one must fail.
  const d5c = clone('case5c-agent-script-reference');
  put(d5c, 'plugins/rigor/agents/tracer.md', `${readIn(d5c, 'plugins/rigor/agents/tracer.md')}\nRun \${CLAUDE_PLUGIN_ROOT}/scripts/missing-agent.mjs.\n`);
  const r5c = runLint(d5c);
  check('5c. agent script reference exits 1', r5c.status === 1);
  check('5c. message names agent source and missing helper', r5c.all.includes('plugins/rigor/agents/tracer.md') && r5c.all.includes('missing-agent.mjs'));

  const d5d = clone('case5d-readme-script-reference');
  put(d5d, 'plugins/rigor/README.md', `${readIn(d5d, 'plugins/rigor/README.md')}\nRun \${CLAUDE_PLUGIN_ROOT}/scripts/missing-readme.mjs.\n`);
  const r5d = runLint(d5d);
  check('5d. README script reference exits 1', r5d.status === 1);
  check('5d. message names README source and missing helper', r5d.all.includes('plugins/rigor/README.md') && r5d.all.includes('missing-readme.mjs'));

  const d5e = clone('case5e-manifest-script-reference');
  const manifest5e = JSON.parse(readIn(d5e, 'plugins/rigor/.claude-plugin/plugin.json'));
  manifest5e.runtime = '${CLAUDE_PLUGIN_ROOT}/scripts/missing-manifest.mjs';
  put(d5e, 'plugins/rigor/.claude-plugin/plugin.json', JSON.stringify(manifest5e, null, 2));
  const r5e = runLint(d5e);
  check('5e. plugin manifest script reference exits 1', r5e.status === 1);
  check('5e. message names manifest source and missing helper', r5e.all.includes('plugins/rigor/.claude-plugin/plugin.json') && r5e.all.includes('missing-manifest.mjs'));

  // 5f-g. FAÇADE SCRIPT REFERENCES — `co.mjs <domain> <verb>` runs a sibling script, so the
  // check must resolve the verb through co.mjs's own table and require that script bundled.
  // Without the resolution the reference reads as "co.mjs is bundled" and the missing verb
  // script goes unnoticed until the skill runs. The real co.mjs is copied in, since the
  // resolution is only meaningful against the actual verb table.
  const REAL_CO = join(REPO, 'scripts', 'co.mjs');
  const REAL_NARRATION = join(REPO, 'scripts', 'scan-narration.mjs');
  const withFacade = (label, { bundleVerbScript }) => {
    const dir = clone(label);
    copyFileSync(REAL_CO, join(dir, 'scripts', 'co.mjs'));
    copyFileSync(REAL_CO, join(dir, 'plugins', 'rigor', 'scripts', 'co.mjs'));
    const declared = [{ name: 'fixture-tool.mjs', plugins: ['rigor'] }, { name: 'co.mjs', plugins: ['rigor'] }];
    if (bundleVerbScript) {
      copyFileSync(REAL_NARRATION, join(dir, 'scripts', 'scan-narration.mjs'));
      copyFileSync(REAL_NARRATION, join(dir, 'plugins', 'rigor', 'scripts', 'scan-narration.mjs'));
      declared.push({ name: 'scan-narration.mjs', plugins: ['rigor'] });
    }
    put(dir, 'scripts/vendored-manifest.mjs', `export const RUNTIME_SCRIPTS = ${JSON.stringify(declared, null, 2)};\n`);
    put(dir, 'plugins/rigor/agents/tracer.md', `${readIn(dir, 'plugins/rigor/agents/tracer.md')}\nRun \${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs scan narration REPORT.md.\n`);
    return runLint(dir);
  };

  const r5f = withFacade('case5f-facade-unbundled-verb', { bundleVerbScript: false });
  check('5f. a façade reference to an unbundled verb exits 1', r5f.status === 1);
  check('5f. message names the resolved script and the façade path',
    r5f.all.includes('scan-narration.mjs but it is not bundled') && r5f.all.includes('via co.mjs scan narration'));

  const r5g = withFacade('case5g-facade-bundled-verb', { bundleVerbScript: true });
  check('5g. control: the same reference passes once the verb script is bundled', r5g.status === 0);

  // 5h. A FAÇADE REFERENCE TO A VERB THE TABLE DOES NOT CARRY is a typo, not a free pass.
  const d5h = clone('case5h-facade-unknown-verb');
  copyFileSync(REAL_CO, join(d5h, 'scripts', 'co.mjs'));
  copyFileSync(REAL_CO, join(d5h, 'plugins', 'rigor', 'scripts', 'co.mjs'));
  put(d5h, 'scripts/vendored-manifest.mjs', "export const RUNTIME_SCRIPTS = [\n  { name: 'fixture-tool.mjs', plugins: ['rigor'] },\n  { name: 'co.mjs', plugins: ['rigor'] },\n];\n");
  put(d5h, 'plugins/rigor/agents/tracer.md', `${readIn(d5h, 'plugins/rigor/agents/tracer.md')}\nRun \${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs scan nosuchverb REPORT.md.\n`);
  const r5h = runLint(d5h);
  check('5h. a façade reference to an unknown verb exits 1', r5h.status === 1);
  check('5h. message names the verb table', r5h.all.includes('not in the co.mjs verb table'));

  // 6. ADVISORY NON-GATING — an orphan root script with no evals/ reference is flagged
  // as advisory text but must NEVER fail the run.
  const d6 = clone('case6-advisory-orphan');
  put(d6, 'scripts/orphan-tool.mjs', '// Never referenced under evals/ on purpose (case 6 mutation).\nexport const ORPHAN = true;\n');
  const r6 = runLint(d6);
  check('6. orphan script stays advisory-only, exit 0', r6.status === 0);
  check('6. output flags it as advisory', r6.all.includes('advisory:') && r6.all.includes('orphan-tool.mjs'));

  // 7. AGENT PASSAGE DRIFT — an agents/*.md pinned doctrine clause (AGENT_SHARED_PASSAGES)
  // diverges from its canonical text; must fail closed same as the CONVENTIONS.md-level
  // SHARED_PASSAGES check.
  const d7 = clone('case7-agent-passage-drift');
  put(d7, 'plugins/rigor/agents/tracer.md', agentBody('tracer', 'opus', [
    'If the question is ambiguous, return the open question to the orchestrator instead of gu3ssing (case 7 mutation).',
    AGENT_REDACT_FULL,
    AGENT_TIER_BOUNDARY,
  ]));
  const r7 = runLint(d7);
  check('7. agent passage drift exits 1', r7.status === 1);
  check('7. message mentions the drifted agent passage', r7.all.includes('agent-escalate-dont-guess') && r7.all.includes('plugins/rigor/agents/tracer.md'));

  // 7b/7c. AGENT REPORT CAP — an agent body with no "Report cap" line, or a cap above the
  // 800-word ceiling, must fail closed and name the file (lint check 25).
  const tracerTexts = [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_FULL, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY];
  const d7b = clone('case7b-agent-report-cap-missing');
  put(d7b, 'plugins/rigor/agents/tracer.md', agentBody('tracer', 'opus', tracerTexts, ''));
  const r7b = runLint(d7b);
  check('7b. missing agent report cap exits 1', r7b.status === 1);
  check('7b. message names the uncapped agent', r7b.all.includes('plugins/rigor/agents/tracer.md: agent body has no "Report cap: at most N words" line'));
  const d7c = clone('case7c-agent-report-cap-oversized');
  put(d7c, 'plugins/rigor/agents/tracer.md', agentBody('tracer', 'opus', tracerTexts, 'Report cap: at most 5000 words.'));
  const r7c = runLint(d7c);
  check('7c. oversized agent report cap exits 1', r7c.status === 1);
  check('7c. message names the oversized cap', r7c.all.includes('plugins/rigor/agents/tracer.md: report cap of 5000 words is outside 100-800'));

  // 8. BOGUS COMPOSITION EDGE — code-ops-docs/40 Engineering/Techniques/skill-composition.md table cell names a
  // plugin:skill edge that does not resolve to a real plugins/<plugin>/skills/<skill>/ dir.
  const d8 = clone('case8-bogus-composition-edge');
  put(d8, 'code-ops-docs/40 Engineering/Techniques/skill-composition.md', [
    '# Skill composition (fixture)',
    '',
    '| From skill | Invokes | Notes |',
    '| --- | --- | --- |',
    '| `rigor:bug-hunt` | `no-such-plugin:no-such-skill` | fixture invalid edge (case 8 mutation) |',
    '',
  ].join('\n'));
  const r8 = runLint(d8);
  check('8. bogus composition edge exits 1', r8.status === 1);
  check('8. message mentions the unresolved edge', r8.all.includes('unknown plugin "no-such-plugin"'));

  // 9. EVAL-WIRED-TO-CI (check 18) — a new evals/<name>/run.mjs never referenced in validate.yml.
  const d9 = clone('case9-unwired-eval');
  put(d9, 'evals/orphan-eval/run.mjs', "// Deliberately NOT referenced in validate.yml (case 9 mutation).\nconsole.log('never wired');\n");
  const r9 = runLint(d9);
  check('9. unwired eval exits 1', r9.status === 1);
  check('9. message names the unwired eval', r9.all.includes('evals/orphan-eval/run.mjs') && r9.all.includes('not invoked'));

  // 10. AUTO-MERGE DENYLIST (check 19) — a script wiring `gh pr merge --auto`.
  const d10 = clone('case10-auto-merge');
  put(d10, 'scripts/auto-merger.mjs', "// Fixture script (case 10 mutation): wires PR auto-merge, which is denylisted.\nconst cmd = 'gh pr merge --auto';\n");
  const r10 = runLint(d10);
  check('10. gh pr merge --auto exits 1', r10.status === 1);
  check('10. message flags the auto-merge denylist', r10.all.includes('auto-merge denylist'));

  // 11. STANDARDS-CONTRACT IMPORT (check 20): a full contract copy in CLAUDE.md. Two
  // copies are how the writing-standard section once lived in CLAUDE.md alone, unseen by
  // Codex and opencode, and they cost Grok Build the contract twice per turn.
  const d11 = clone('case11-contract-full-copy');
  put(d11, 'CLAUDE.md', FIXTURE_CONTRACT);
  const r11 = runLint(d11);
  check('11. a full contract copy in CLAUDE.md exits 1', r11.status === 1);
  check('11. message names the import line and the fix', r11.all.includes('CLAUDE.md must be exactly the import line'));

  // 11b. A MISSING AGENTS.md leaves every host with nothing, since CLAUDE.md only imports it.
  const d11b = clone('case11b-contract-missing');
  rmSync(join(d11b, 'AGENTS.md'), { force: true });
  const r11b = runLint(d11b);
  check('11b. a missing AGENTS.md exits 1', r11b.status === 1);
  check('11b. message says which hosts lose it', r11b.all.includes('AGENTS.md is missing'));

  // 11c. An import of the wrong target has the right shape and loads the wrong file.
  const d11c = clone('case11c-contract-wrong-target');
  put(d11c, 'CLAUDE.md', '@README.md\n');
  const r11c = runLint(d11c);
  check('11c. a wrong import target exits 1', r11c.status === 1);
  check('11c. message names the import line', r11c.all.includes('CLAUDE.md must be exactly the import line'));

  // 11d. An empty AGENTS.md satisfies existence but carries no contract.
  const d11d = clone('case11d-contract-empty');
  put(d11d, 'AGENTS.md', '\n');
  const r11d = runLint(d11d);
  check('11d. an empty AGENTS.md exits 1', r11d.status === 1);
  check('11d. message says AGENTS.md is empty', r11d.all.includes('AGENTS.md is empty'));

  // 11e. The only tolerance is one trailing newline: the bare line passes, and the import
  // line followed by more prose fails.
  const d11e = clone('case11e-import-no-newline');
  put(d11e, 'CLAUDE.md', '@AGENTS.md');
  const r11e = runLint(d11e);
  check('11e. the import line without a trailing newline passes', r11e.status === 0);
  const d11f = clone('case11f-import-plus-prose');
  put(d11f, 'CLAUDE.md', '@AGENTS.md\n\nClaude-only note.\n');
  const r11f = runLint(d11f);
  check('11f. the import line plus extra prose exits 1', r11f.status === 1);

  // 12. COMPOSITION MAP COMPLETENESS (check 22) — the map must match the skill tree in
  // BOTH directions. Case 8 above only exercises check 17 (does a named edge resolve),
  // so every assertion here reads check 22's OWN message text: check 17 can never satisfy
  // it. The fixture plants one real cross-skill reference and the matching edge row, then
  // each mutation breaks one direction.
  const COMP_PATH = 'code-ops-docs/40 Engineering/Techniques/skill-composition.md';
  const COMP_EDGE_ROW = '| `rigor:quality-scan` | `rigor:bug-hunt` | fixture edge (case 12) |';
  const compPage = (rows) => [
    '# Skill composition (fixture)',
    '',
    'Fixture composition map for evals/lint-plugins/run.mjs.',
    '',
    '## The edges',
    '',
    '| From skill | Invokes | When |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  // The referring skill: quality-scan names bug-hunt in its body, so the tree carries the
  // edge `rigor:quality-scan` -> `rigor:bug-hunt`.
  const REFERRING_SKILL = 'plugins/rigor/skills/quality-scan/SKILL.md';
  const referringBody = skillBody('QUALITY SCAN', {
    extra: '\nWhen a finding needs proof, hand it to `rigor:bug-hunt` (case 12 fixture reference).\n',
  });

  // 12. WELL-FORMED MAP — reference and row both present: check 22 stays quiet. This pins
  // the fixture itself, so 12a/12b/12c prove their mutation and not a broken baseline.
  const d12 = clone('case12-composition-map-ok');
  put(d12, REFERRING_SKILL, referringBody);
  put(d12, COMP_PATH, compPage([COMP_EDGE_ROW]));
  const r12 = runLint(d12);
  check('12. a map matching the skill tree exits 0', r12.status === 0);

  // 12a. TREE -> TABLE — the reference exists, its edge row is deleted from the map.
  const d12a = clone('case12a-composition-missing-row');
  put(d12a, REFERRING_SKILL, referringBody);
  put(d12a, COMP_PATH, compPage([]));
  const r12a = runLint(d12a);
  check('12a. a reference with no edge row exits 1', r12a.status === 1);
  check('12a. message is check 22\'s own "has no edge row"', r12a.all.includes('qualified reference "rigor:bug-hunt" from "rigor:quality-scan" has no edge row'));

  // 12b. TABLE -> TREE — an edge row naming two REAL skills (so check 17 resolves it
  // cleanly and cannot be what fires) with no matching reference anywhere in the tree.
  const d12b = clone('case12b-composition-extra-row');
  put(d12b, REFERRING_SKILL, referringBody);
  put(d12b, COMP_PATH, compPage([
    COMP_EDGE_ROW,
    '| `rigor:deep-review` | `code-ops-suite:everything` | fixture phantom row (case 12b mutation) |',
  ]));
  const r12b = runLint(d12b);
  check('12b. an edge row with no reference exits 1', r12b.status === 1);
  check('12b. message is check 22\'s own "matches no qualified reference"', r12b.all.includes('edge row "rigor:deep-review" -> "code-ops-suite:everything" matches no qualified reference'));
  check('12b. check 17 is not what fired (both names resolve)', !r12b.all.includes('unknown plugin') && !r12b.all.includes('unresolvable skill'));

  // 12c. SECTION SCOPING, no-false-positive floor — a non-edge-shaped table elsewhere on
  // the page (one qualified name per row, prose in the second cell, the shape of a real
  // "other notes" table) stays quiet. This case only pins that floor; the discrimination
  // that out-of-section rows are not edges lives in 12e (edge-shaped rows fail outright)
  // and 12f (rows under a nested subheading stay inside the section).
  const d12c = clone('case12c-composition-second-table');
  put(d12c, REFERRING_SKILL, referringBody);
  put(d12c, COMP_PATH, `${compPage([COMP_EDGE_ROW])}
## Other notes

| Skill | Note |
| --- | --- |
| \`rigor:bug-hunt\` | not an edge row — outside "## The edges" (case 12c) |
`);
  const r12c = runLint(d12c);
  check('12c. a table outside "## The edges" is not read as edges, exit 0', r12c.status === 0);

  // 12d. "Invoked as" LINES ARE SCANNED — the cross-reference sits on the skill's own
  // "Invoked as" line, which check 22 does not skip. Only the skill's own name is
  // excluded, so this edge still needs a row. Restoring the old line-skip fails this case.
  const d12d = clone('case12d-composition-invoked-as-line');
  put(d12d, REFERRING_SKILL, skillBody('QUALITY SCAN', {
    extra: '\n**Invoked as `/rigor:quality-scan`.** Hand proof work to `rigor:bug-hunt` (case 12d fixture reference).\n',
  }));
  put(d12d, COMP_PATH, compPage([]));
  const r12d = runLint(d12d);
  check('12d. a reference on an "Invoked as" line still needs an edge row', r12d.status === 1);
  check('12d. message is check 22\'s own "has no edge row"', r12d.all.includes('qualified reference "rigor:bug-hunt" from "rigor:quality-scan" has no edge row'));

  // 12e. THE SCOPING IS NOT AN ESCAPE HATCH — an edge-shaped phantom row (two real
  // qualified skill names in the first two cells) parked under another heading must fail
  // rather than go quiet. Check 17 cannot catch it: both names resolve.
  const d12e = clone('case12e-composition-phantom-outside');
  put(d12e, REFERRING_SKILL, referringBody);
  put(d12e, COMP_PATH, `${compPage([COMP_EDGE_ROW])}
## Standalone skills

| Skill | Neighbour | Note |
| --- | --- | --- |
| \`rigor:deep-review\` | \`code-ops-suite:everything\` | phantom row parked outside the edges section (case 12e mutation) |
`);
  const r12e = runLint(d12e);
  check('12e. an edge-shaped row outside "## The edges" exits 1', r12e.status === 1);
  check('12e. message is the out-of-section guard', r12e.all.includes('edge-shaped row outside the edges section'));
  check('12e. check 17 is not what fired (both names resolve)', !r12e.all.includes('unknown plugin') && !r12e.all.includes('unresolvable skill'));

  // 12f. NESTED SUBHEADINGS STAY INSIDE THE SECTION — only a heading at or above the
  // edges heading's own level closes it. An edge row under a "### " subheading of
  // "## The edges" is still an edge, so it satisfies the tree reference and does not
  // trip the out-of-section guard.
  const d12f = clone('case12f-composition-nested-subheading');
  put(d12f, REFERRING_SKILL, referringBody);
  put(d12f, COMP_PATH, [
    '# Skill composition (fixture)',
    '',
    '## The edges',
    '',
    '### A grouping subheading',
    '',
    '| From skill | Invokes | When |',
    '| --- | --- | --- |',
    COMP_EDGE_ROW,
    '',
  ].join('\n'));
  const r12f = runLint(d12f);
  check('12f. an edge row under a nested subheading still counts, exit 0', r12f.status === 0);
  check('12f. no out-of-section guard fired', !r12f.all.includes('edge-shaped row outside the edges section'));

  // 12g. FENCED EXAMPLES ARE NOT PAGE STRUCTURE — a fenced markdown sample carrying both a
  // heading and an edge-shaped row must not close the section, open a second one, or be
  // read as an edge. The real edge sits after the fence, so it only stays satisfied if the
  // fence left `inEdges` alone. Both scan loops (checks 17 and 22) skip fences.
  const d12g = clone('case12g-composition-fenced-example');
  put(d12g, REFERRING_SKILL, referringBody);
  put(d12g, COMP_PATH, [
    '# Skill composition (fixture)',
    '',
    '## The edges',
    '',
    'An example of the row shape:',
    '',
    '```markdown',
    '## Standalone skills',
    '',
    '| `rigor:deep-review` | `code-ops-suite:everything` | example row inside a fence |',
    '```',
    '',
    '| From skill | Invokes | When |',
    '| --- | --- | --- |',
    COMP_EDGE_ROW,
    '',
  ].join('\n'));
  const r12g = runLint(d12g);
  check('12g. a fenced markdown example does not disturb the edges section, exit 0', r12g.status === 0);
  check('12g. the fenced edge-shaped row is not read as an out-of-section row',
    !r12g.all.includes('edge-shaped row outside the edges section'));
  check('12g. the fenced row is not read as an edge needing a reference',
    !r12g.all.includes('matches no qualified reference'));

  // 12h. A DEGENERATE REPEATED "The edges" HEADING DOES NOT DEEPEN THE SECTION LEVEL — the
  // level is set on the heading that OPENS the section, so a nested duplicate cannot make a
  // later sibling subheading close it early and strand a real edge row outside.
  const d12h = clone('case12h-composition-repeated-edges-heading');
  put(d12h, REFERRING_SKILL, referringBody);
  put(d12h, COMP_PATH, [
    '# Skill composition (fixture)',
    '',
    '## The edges',
    '',
    '### The edges',
    '',
    '### Another grouping subheading',
    '',
    '| From skill | Invokes | When |',
    '| --- | --- | --- |',
    COMP_EDGE_ROW,
    '',
  ].join('\n'));
  const r12h = runLint(d12h);
  check('12h. a repeated nested "The edges" heading does not close the section early, exit 0',
    r12h.status === 0);
  check('12h. no out-of-section guard fired',
    !r12h.all.includes('edge-shaped row outside the edges section'));

  // 13. SHIPPED REFERENCES (check 24) — shipped plugin text must not name a path that exists
  // only in a code-ops checkout. Each failing case has a passing partner that changes one thing,
  // so a case proves the rule's discrimination rather than a broken fixture.
  const BUG_HUNT = 'plugins/rigor/skills/bug-hunt/SKILL.md';
  const withBugHuntText = (label, extra) => {
    const dir = clone(label);
    put(dir, BUG_HUNT, skillBody('BUG HUNT', { extra: `\n${extra}\n` }));
    return dir;
  };

  // 13a/13b. An unmarked hub path fails; the same path in a block that names the code-ops
  // repository passes.
  const r13a = runLint(withBugHuntText('case13a-hub-unmarked', 'Read `code-ops-docs/40 Engineering/Handbook/README.md` first.'));
  check('13a. an unmarked hub path exits 1', r13a.status === 1);
  check('13a. message is check 24\'s hub report', r13a.all.includes('check 24 [claude] plugins/rigor/skills/bug-hunt/SKILL.md') && r13a.all.includes('hub reference "code-ops-docs/40 Engineering/Handbook/README.md"'));
  const r13b = runLint(withBugHuntText('case13b-hub-marked', 'Read `code-ops-docs/40 Engineering/Handbook/README.md` in the code-ops repository.'));
  check('13b. the same hub path under a code-ops repository marker exits 0', r13b.status === 0);

  // 13c. A marker in a different block does not cover the path.
  const r13c = runLint(withBugHuntText('case13c-hub-marker-other-block', 'This skill ships with the code-ops repository.\n\nRead `code-ops-docs/40 Engineering/Handbook/README.md` first.'));
  check('13c. a marker in another paragraph does not cover the path, exit 1', r13c.status === 1 && r13c.all.includes('hub reference'));

  // 13d/13e. A plugin-root path to a file the plugin does not ship fails; it passes once the
  // file ships.
  const ROOT_REF = 'Follow `${CLAUDE_PLUGIN_ROOT}/reference/guide.md`.';
  const r13d = runLint(withBugHuntText('case13d-root-missing', ROOT_REF));
  check('13d. a missing plugin-root file exits 1', r13d.status === 1);
  check('13d. message is check 24\'s root report', r13d.all.includes('root reference "${CLAUDE_PLUGIN_ROOT}/reference/guide.md" names a file this plugin does not ship'));
  const d13e = withBugHuntText('case13e-root-resolves', ROOT_REF.replace('reference/guide.md', 'docs/guide.md'));
  put(d13e, 'plugins/rigor/docs/guide.md', '# Fixture guide\n');
  const r13e = runLint(d13e);
  check('13e. a plugin-root path to a shipped file exits 0', r13e.status === 0);

  // 13f/13g. A file-level marker on the Mode line exempts its file. The same words on another
  // line do not, so the exemption cannot spread by accident.
  const REPO_COMMAND = 'Run this first:\n\n```text\nnode scripts/build-codex-marketplace.mjs --check\n```';
  const r13f = runLint(withBugHuntText('case13f-file-marker', `**Mode:** ASSESS · **Runs in:** the code-ops repository · **Produces:** a fixture report.\n\n${REPO_COMMAND}`));
  check('13f. a Mode-line file marker exempts the file, exit 0', r13f.status === 0);
  const r13g = runLint(withBugHuntText('case13g-file-marker-off-mode-line', `**Mode:** ASSESS · **Produces:** a fixture report.\n\n**Runs in:** the code-ops repositories list.\n\n${REPO_COMMAND}`));
  check('13g. the marker words off the Mode line do not exempt the file, exit 1', r13g.status === 1 && r13g.all.includes('cmd reference "node scripts/build-codex-marketplace.mjs"'));

  // 13h. Source comments never reach a user, so a comment line passes; the same text printed
  // by the script fails.
  const d13h = clone('case13h-code-comment-vs-printed');
  put(d13h, 'plugins/rigor/scripts/fixture-tool.mjs', "// Fixture runtime script for evals/lint-plugins/run.mjs (vendored-script parity check).\nexport const FIXTURE_TOOL = true;\n// usage: node scripts/fixture-tool.mjs\n");
  put(d13h, 'scripts/fixture-tool.mjs', "// Fixture runtime script for evals/lint-plugins/run.mjs (vendored-script parity check).\nexport const FIXTURE_TOOL = true;\n// usage: node scripts/fixture-tool.mjs\n");
  check('13h. a repository command in a source comment exits 0', runLint(d13h).status === 0);
  const printed = "// Fixture runtime script for evals/lint-plugins/run.mjs (vendored-script parity check).\nexport const FIXTURE_TOOL = 'usage: node scripts/fixture-tool.mjs';\n";
  put(d13h, 'plugins/rigor/scripts/fixture-tool.mjs', printed);
  put(d13h, 'scripts/fixture-tool.mjs', printed);
  const r13h = runLint(d13h);
  check('13h. the same command printed by the script exits 1', r13h.status === 1 && r13h.all.includes('check 24 [claude] plugins/rigor/scripts/fixture-tool.mjs:2: cmd reference'));

  // 13i. Both host projections take the same scan, so a renderer cannot author a gap.
  const d13i = clone('case13i-projections');
  put(d13i, 'codex-marketplace/plugins/rigor/README.md', '# rigor for Codex\n\nRebuild it with `node scripts/build-codex-marketplace.mjs`.\n');
  put(d13i, 'opencode-dist/MODEL_TIERS.md', '# Model tiers\n\nGenerated by `scripts/build-opencode-dist.mjs`.\n');
  const r13i = runLint(d13i);
  check('13i. an unmarked projection reference exits 1', r13i.status === 1);
  check('13i. the Codex projection is scanned', r13i.all.includes('check 24 [codex] codex-marketplace/plugins/rigor/README.md:3: cmd reference'));
  check('13i. the OpenCode projection is scanned', r13i.all.includes('check 24 [opencode] opencode-dist/MODEL_TIERS.md:3: cite reference "scripts/build-opencode-dist.mjs"'));

  // 13j/13k. A vendored reference copy stays byte-identical to its hub page.
  const withVendoredReference = (label, copyText) => {
    const dir = clone(label);
    const spec = '# Fixture spec\n\nThe fixture grammar.\n';
    put(dir, 'code-ops-docs/40 Engineering/Techniques/fixture-spec.md', spec);
    put(dir, 'plugins/rigor/reference/fixture-spec.md', copyText ?? spec);
    put(dir, 'scripts/vendored-manifest.mjs', [
      "export const RUNTIME_SCRIPTS = [\n  { name: 'fixture-tool.mjs', plugins: ['rigor'] },\n];",
      "export const REFERENCE_SOURCE_DIR = 'code-ops-docs/40 Engineering/Techniques';",
      "export const VENDORED_REFERENCES = [\n  { name: 'fixture-spec.md', plugins: ['rigor'] },\n];",
      '',
    ].join('\n'));
    return runLint(dir);
  };
  check('13j. a byte-identical vendored reference exits 0', withVendoredReference('case13j-reference-parity').status === 0);
  const r13k = withVendoredReference('case13k-reference-drift', '# Fixture spec\n\nThe fixture grammar, edited in the copy.\n');
  check('13k. a drifted vendored reference exits 1', r13k.status === 1);
  check('13k. message names the drifted copy', r13k.all.includes('rigor: reference/fixture-spec.md has drifted from the canonical'));

  // 13l/13m. A JSON-escaped quote after a plugin-root path is not part of the path. The captured
  // path must end before the backslash on every platform, so a shipped file resolves on POSIX too.
  const r13l = runLint(withBugHuntText('case13l-root-escaped-quote-missing', 'The hook entry reads "node \\"${CLAUDE_PLUGIN_ROOT}/docs/missing-guide.md\\"".'));
  check('13l. an escaped-quote plugin-root path to a missing file exits 1', r13l.status === 1);
  check('13l. the reported path stops before the escaped quote', r13l.all.includes('root reference "${CLAUDE_PLUGIN_ROOT}/docs/missing-guide.md" names a file this plugin does not ship'));
  const d13m = withBugHuntText('case13m-root-escaped-quote-resolves', 'The hook entry reads "node \\"${CLAUDE_PLUGIN_ROOT}/docs/guide.md\\"".');
  put(d13m, 'plugins/rigor/docs/guide.md', '# Fixture guide\n');
  check('13m. an escaped-quote plugin-root path to a shipped file exits 0', runLint(d13m).status === 0);

  // 14. PRODUCER_STRICT (check 13) — the rigor finding producers keep the strict finding-rigor
  // register gate, and normalize keeps --min-items, in the Done-when invocation itself.
  const withProducerBody = (label, rel, title, opts) => {
    const dir = clone(label);
    put(dir, rel, skillBody(title, opts));
    return runLint(dir);
  };
  const r14a = withProducerBody('case14a-bughunt-not-strict', BUG_HUNT, 'BUG HUNT', { doneFlags: '--root .' });
  check('14a. bug-hunt Done-when without --strict --profile finding-rigor exits 1', r14a.status === 1);
  check('14a. message names the strict producer gate', r14a.all.includes('plugins/rigor/skills/bug-hunt/SKILL.md: Done-when no longer runs revalidate-register.mjs with --strict --profile finding-rigor'));
  const r14b = withProducerBody('case14b-deepreview-not-strict', 'plugins/rigor/skills/deep-review/SKILL.md', 'DEEP REVIEW', { doneRevalidate: false, extra: '\nRun revalidate-register.mjs --strict --profile finding-rigor before the Done-when.\n' });
  check('14b. deep-review with the strict flags outside its Done-when exits 1', r14b.status === 1 && r14b.all.includes('deep-review/SKILL.md: Done-when no longer runs revalidate-register.mjs with --strict'));
  const r14c = withProducerBody('case14c-normalize-no-min-items', 'plugins/code-ops-suite/skills/normalize/SKILL.md', 'NORMALIZE', { doneFlags: '--strict --profile consistency' });
  check('14c. normalize Done-when without --min-items exits 1', r14c.status === 1 && r14c.all.includes('with --strict --profile consistency --min-items 1'));

  // 15. AGENT CONTRACT (check 26), DISPATCH PROSE (check 27), BOUNDED CONVENTIONS READ (check 28).
  const mechWith = (label, contract, tools = MECH_OPTS.tools) => {
    const dir = clone(label);
    put(dir, 'plugins/code-ops-suite/agents/mech.md', agentBody('mech', 'sonnet', [AGENT_BATCH, AGENT_ESCALATE, AGENT_REDACT_SHORT], AGENT_REPORT_CAP, { tools, contract }));
    return runLint(dir);
  };
  const r15a = mechWith('case15a-no-contract', '');
  check('15a. an agent with no Contract section exits 1', r15a.status === 1 && r15a.all.includes('plugins/code-ops-suite/agents/mech.md: agent has no "## Contract" section'));
  const r15b = mechWith('case15b-edits-none-with-edit', agentContract('none'));
  check('15b. Edits: none with Edit and Write in tools exits 1', r15b.status === 1 && r15b.all.includes('declares "Edits: none" but tools grant Edit, Write'));
  check('15b. Edits: none with read-only tools exits 0', mechWith('case15b-edits-none-read-only', agentContract('none'), 'Read, Grep, Glob, Bash').status === 0);
  const r15c = mechWith('case15c-two-tokens-in-first-line', MECH_OPTS.contract.replace('ANSWERED: fixture answer', 'ANSWERED | ESCALATE: fixture answer'));
  check('15c. a fenced first line naming two verdict tokens before ":" exits 1', r15c.status === 1 && r15c.all.includes('must begin with exactly one declared verdict token followed by ":"'));
  check('15c. a fenced first line naming exactly one verdict token exits 0', mechWith('case15c-single-token', MECH_OPTS.contract).status === 0);
  const r15d = mechWith('case15d-bad-brief-field', MECH_OPTS.contract.replace('Expected return', 'Vibes'));
  check('15d. an unknown brief field exits 1', r15d.status === 1 && r15d.all.includes('names brief field "Vibes"'));

  const withTech = (label, text) => {
    const dir = clone(label);
    put(dir, 'code-ops-docs/40 Engineering/Techniques/fixture-routing.md', `# Fixture routing\n\n${text}\n`);
    return runLint(dir);
  };
  check('15e. a dispatch list of shipped agents exits 0', withTech('case15e-list-ok', 'Dispatch code-ops-suite:implementer, reviewer, or mech, or add a reason line.').status === 0);
  const r15f = withTech('case15f-list-unshipped', 'Dispatch code-ops-suite:implementer, reviewer, or wrangler, or add a reason line.');
  check('15f. an unshipped name in a dispatch list exits 1', r15f.status === 1 && r15f.all.includes('fixture-routing.md:3: dispatch list after "code-ops-suite:implementer" names "wrangler"'));
  const r15g = withTech('case15g-qualified-unshipped', 'Run `rigor:ghost-hunt` first.');
  check('15g. a qualified name with no skill or agent exits 1', r15g.status === 1 && r15g.all.includes('"rigor:ghost-hunt" names no shipped skill or agent of rigor'));
  const r15h = withTech('case15h-floor-list', 'Route to `sonnet`-floor agents (`mech`, `wrangler`).');
  check('15h. a floor list naming an unshipped agent exits 1', r15h.status === 1 && r15h.all.includes('floor list names agent "wrangler"') && !r15h.all.includes('agent "mech"'));
  const d15i = clone('case15i-hook-unshipped');
  put(d15i, 'plugins/code-ops-suite/hooks/fixture-guard.mjs', "export const DENY = 'dispatch code-ops-suite:implementer, reviewer, or wrangler instead';\n");
  const r15i = runLint(d15i);
  check('15i. a hook deny text naming an unshipped agent exits 1', r15i.status === 1 && r15i.all.includes('hooks/fixture-guard.mjs:1: dispatch list after'));

  // Check 3 requires every skill to cite CONVENTIONS.md, so the baseline, which carries the
  // bound sentence, is 15j's passing partner.
  const d15j = clone('case15j-conventions-unbounded');
  put(d15j, BUG_HUNT, skillBody('BUG HUNT').replace(' Leave the rest of that file unread.', ''));
  const r15j = runLint(d15j);
  check('15j. a skill citing CONVENTIONS.md without the bound sentence exits 1', r15j.status === 1 && r15j.all.includes('bug-hunt/SKILL.md: cites CONVENTIONS.md without the sentence "Leave the rest of that file unread."'));

  // 16a-16c. CHANGELOG STUBS (lint check 29) — a written entry passes; a bump-script TODO
  // placeholder or a repeated version heading fails closed and names the line.
  const withChangelog = (label, text) => {
    const dir = clone(label);
    put(dir, 'plugins/rigor/CHANGELOG.md', `# Changelog — rigor\n\n${text}`);
    return runLint(dir);
  };
  check('16a. a CHANGELOG with written entries exits 0', withChangelog('case16a-changelog-ok', '## 0.1.0\n- Fixture entry.\n\n## 0.0.9\n- Older entry.\n').status === 0);
  const r16b = withChangelog('case16b-changelog-todo', '## 0.1.0\n- **TODO** — describe the change.\n\n## 0.0.9\n- Older entry.\n');
  check('16b. a TODO placeholder line exits 1', r16b.status === 1 && r16b.all.includes('plugins/rigor/CHANGELOG.md:4: placeholder "**TODO**" line'));
  const r16c = withChangelog('case16c-changelog-duplicate', '## 0.1.0\n- Fixture entry.\n\n## 0.1.0\n- Same version again.\n');
  check('16c. a duplicated version heading exits 1', r16c.status === 1 && r16c.all.includes('plugins/rigor/CHANGELOG.md:6: duplicate "## 0.1.0" heading'));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} lint-plugins regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all lint-plugins regression checks passed.');
