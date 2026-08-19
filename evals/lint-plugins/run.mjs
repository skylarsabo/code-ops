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
//       plugins/rigor/skills/{bug-hunt,quality-scan,consistency-closure}/SKILL.md
//       plugins/code-ops-suite/skills/codebase-audit/SKILL.md
//   - SHARED_PASSAGES (its check 14) requires — unconditionally, for every entry's `files`
//     list, regardless of whether that plugin is registered — CONVENTIONS.md to exist and
//     carry a pinned sentence verbatim at FOUR hardcoded plugin paths: code-ops-suite,
//     rigor, privacy-opsec-suite, researcher (~22 sentences shared across most of them),
//     plus 'always-gated-core' which ALSO requires
//     plugins/code-ops-suite/skills/everything/SKILL.md to exist and carry its sentence.
// Contrast: the agent-related checks (9/10/12, AGENT_MODEL_FLOORS included) and the
// per-skill handbook checks ARE properly conditional (an agents/ dir, a docs/handbook/
// commands/ dir, a plugin's own skill list) and skip cleanly when a fixture omits them —
// verified by reading their `if (existsSync(...))` / `for (slug of p.skills)` guards in
// scripts/lint-plugins.mjs. PRODUCER_SELFCHECK and SHARED_PASSAGES have no such guard: they
// walk their hardcoded path lists regardless of what plugins.length is. Practical upshot: a
// fixture that only registers 2 plugins still needs plugins/privacy-opsec-suite/
// CONVENTIONS.md and plugins/researcher/CONVENTIONS.md to exist on disk (with the doctrine
// text) purely to satisfy SHARED_PASSAGES's existence check — which in turn means those two
// dirs must ALSO be registered marketplace entries (else the separate "unregistered plugin
// dir" check fires on them) and, since docs/handbook/commands/ exists in this fixture, each
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
  "a broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run; do not rely on the platform's concurrency cap as the limiter",
  'skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end',
  "take the union of every slice's skipped/traced note — a high-risk area that no slice covered is itself a finding (a coverage gap), not silence",
  "read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior",
  'must actively LOCATE the would-be handler — the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement',
  'do not block: auto-scope from the repo, proceed on the safe default',
  'are deferred and reported, never silently applied — and surface every decision and critical finding in the final report instead of pausing',
  'stop the fix loop — a cascading cluster is evidence of an architectural problem, not a bug collection',
  'present options at a checkpoint instead of attempting the next fix; in a headless run, defer the remaining cluster and report it',
  'For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value); if no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.',
  'A consumed item ends in exactly one pinned terminal form — `closed-with-proof <commit/PR>`, `deferred-with-reason <reason>`, or `OBSOLETE-AT <sha>` — and never silently disappears',
  'Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it',
  'Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full',
  'is NOT re-paneled — the receipts are the verdict; any drift forces a fresh panel. Hand each panelist the finding block under test plus the cited region (anchor ±30 lines) inline — never the full register',
  'hand its path to every operative brief; operatives consult the map first and use search only to go deeper than the map reaches, never to re-derive layout or find definitions the map already lists',
  "failed dispatch, not a weak signal — never synthesize around a missing report or fill its gap from the orchestrator's own assumptions",
  'redispatch once with a tightened, smaller brief; then escalate at the next checkpoint',
  'The row is written **at dispatch time**, atomically with the dispatch call itself — never a turn earlier or later — because a row written before its dispatch is a phantom indistinguishable from a hung operative',
  "Every operative report is written to the run's artifact folder in the turn it arrives, before any other work — a report that exists only in the conversation is one blocked turn away from being lost.",
  'A brief that never reached its operative is indistinguishable in the dispatch record from a completed dispatch until the report is read, so gate every report on shape — expected sections present, non-empty, evidence attached — before its unit counts as covered.',
  "an operative labels a finding CONFIRMED only when an executed repro or trace appears in its own transcript; a finding argued from static reading caps at PROBABLE, and promotion to CONFIRMED is the lead's act on executed evidence",
  "Panelists get **distinct lenses** (correctness, configuration-reading, reachability), never N identical skeptics — identical readers repeat one another's misreads, and diversity catches what redundancy cannot.",
  'Write to the house writing standard: one term per concept, active voice, one instruction per sentence, 20 words for instructions and 25 for explanation. Identifiers, paths, commands, and quoted output count as one word and are never reworded to fit a limit.',
];
const ALWAYS_GATED_TEXT = '**Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge';
const DOCTRINE_BLOB = [...PINNED_TEXTS, ALWAYS_GATED_TEXT].join('\n\n');

// ---- fixture writer ----------------------------------------------------------------
const put = (root, relPath, content) => {
  const full = join(root, ...relPath.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

const skillBody = (title, { doneRevalidate = true, extra = '' } = {}) => `---
description: "Fixture skill for the lint-plugins regression eval (evals/lint-plugins/run.mjs)."
---

# ${title} (FIXTURE)

Read the bundled CONVENTIONS.md first. This is fixture content; it is not a real skill.
${extra}
## Done when
The fixture task is complete${doneRevalidate ? ' and revalidate-register.mjs has been re-run clean' : ''}.
`;

// ---- fixture agents (AGENT_SHARED_PASSAGES, check 14's agents/*.md sibling in
// scripts/lint-plugins.mjs) — each bundled agent must exist with a frontmatter `model:`
// tier at or above its AGENT_MODEL_FLOORS entry, and carry whichever pinned doctrine
// clauses that agent's file path is listed under. Sentences below are transcribed
// verbatim from AGENT_SHARED_PASSAGES; if that array's `text` values ever change, this
// eval's baseline starts failing loudly — update these to match, same contract as
// PINNED_TEXTS/ALWAYS_GATED_TEXT above.
const AGENT_ESCALATE = 'If the question is ambiguous, return the open question to the orchestrator instead of guessing.';
const AGENT_REDACT_FULL = 'Redact any secrets/PII to `<REDACTED:reason>`; never reproduce a secret value.';
const AGENT_REDACT_SHORT = 'Redact secrets/PII.';
const AGENT_DENSE_EVIDENCE = 'Reports must stay dense and evidence-cited — no raw dumps.';
const AGENT_TIER_BOUNDARY = "Tier at the evidence you have: label a finding CONFIRMED only when an executed repro or trace appears in your own transcript; a finding argued from static reading caps at PROBABLE, and promoting it is the orchestrator's call.";

const agentBody = (name, model, texts) => `---
name: ${name}
description: "Fixture agent for the lint-plugins regression eval (evals/lint-plugins/run.mjs)."
tools: Read, Grep, Glob
model: ${model}
---

# ${name} (FIXTURE)

Fixture agent; not a real agent. Read-only investigation for the fixture task.

${texts.join('\n\n')}
`;

// Builds a MINIMAL tree that scripts/lint-plugins.mjs (copied in, unmodified) passes.
// Two plugins, named/shaped exactly as PRODUCER_SELFCHECK and SHARED_PASSAGES require
// (see the file header note) — 5 skills total, one vendored script, one handbook page
// per plugin plus the router index.
function buildBaseline(root) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(REAL_LINT, join(root, 'scripts', 'lint-plugins.mjs'));
  copyFileSync(REAL_MODEL_TIERS, join(root, 'scripts', 'model-tiers.mjs'));
  // The standards contract ships under both names (check 20). Identical in the baseline;
  // case 11 drifts one copy and case 11b deletes it.
  const contract = '# Fixture standards contract\n\nStands in for the repo contract that CLAUDE.md and AGENTS.md both carry.\n';
  put(root, 'CLAUDE.md', contract);
  put(root, 'AGENTS.md', contract);
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
    '- **`code-ops-suite`** — fixture plugin. (2 skills)',
    '- **`rigor`** — fixture plugin. (3 skills)',
    '- **`privacy-opsec-suite`** — fixture filler plugin. (0 skills)',
    '- **`researcher`** — fixture filler plugin. (0 skills)',
    '',
  ].join('\n'));

  // -- code-ops-suite: codebase-audit (PRODUCER_SELFCHECK) + everything (SHARED_PASSAGES) --
  put(root, 'plugins/code-ops-suite/.claude-plugin/plugin.json', JSON.stringify({ name: 'code-ops-suite', version: '0.1.0', description: 'fixture code-ops-suite plugin' }, null, 2));
  put(root, 'plugins/code-ops-suite/CONVENTIONS.md', `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
  put(root, 'plugins/code-ops-suite/README.md', '# code-ops-suite (fixture)\n\nSkills: codebase-audit, everything.\n');
  put(root, 'plugins/code-ops-suite/skills/codebase-audit/SKILL.md', skillBody('CODEBASE AUDIT'));
  put(root, 'plugins/code-ops-suite/skills/everything/SKILL.md', skillBody('EVERYTHING', {
    doneRevalidate: false,
    extra: `\n${ALWAYS_GATED_TEXT}** without explicit developer approval at a checkpoint.\n`,
  }));
  put(root, 'plugins/code-ops-suite/agents/explorer.md', agentBody('explorer', 'haiku', [AGENT_ESCALATE, AGENT_REDACT_FULL]));
  put(root, 'plugins/code-ops-suite/agents/reviewer.md', agentBody('reviewer', 'opus', [AGENT_ESCALATE, AGENT_REDACT_SHORT, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));

  // -- rigor: bug-hunt, quality-scan, consistency-closure (all PRODUCER_SELFCHECK) --
  put(root, 'plugins/rigor/.claude-plugin/plugin.json', JSON.stringify({ name: 'rigor', version: '0.1.0', description: 'fixture rigor plugin' }, null, 2));
  put(root, 'plugins/rigor/CONVENTIONS.md', `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
  put(root, 'plugins/rigor/README.md', '# rigor (fixture)\n\nSkills: bug-hunt, quality-scan, consistency-closure.\n');
  put(root, 'plugins/rigor/skills/bug-hunt/SKILL.md', skillBody('BUG HUNT'));
  put(root, 'plugins/rigor/skills/quality-scan/SKILL.md', skillBody('QUALITY SCAN'));
  put(root, 'plugins/rigor/skills/consistency-closure/SKILL.md', skillBody('CONSISTENCY CLOSURE'));
  put(root, 'plugins/rigor/agents/tracer.md', agentBody('tracer', 'opus', [AGENT_ESCALATE, AGENT_REDACT_FULL, AGENT_TIER_BOUNDARY]));
  put(root, 'plugins/rigor/agents/verifier.md', agentBody('verifier', 'opus', [AGENT_ESCALATE, AGENT_REDACT_SHORT, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));

  // -- privacy-opsec-suite / researcher: bare SHARED_PASSAGES filler, 0 skills each --
  for (const filler of ['privacy-opsec-suite', 'researcher']) {
    put(root, `plugins/${filler}/.claude-plugin/plugin.json`, JSON.stringify({ name: filler, version: '0.1.0', description: `fixture ${filler} plugin (SHARED_PASSAGES filler)` }, null, 2));
    put(root, `plugins/${filler}/CONVENTIONS.md`, `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
    put(root, `plugins/${filler}/README.md`, `# ${filler} (fixture)\n\nNo skills — SHARED_PASSAGES filler only.\n`);
  }
  // -- privacy-opsec-suite / researcher agents (AGENT_SHARED_PASSAGES filler) --
  put(root, 'plugins/privacy-opsec-suite/agents/explorer.md', agentBody('explorer', 'haiku', [AGENT_ESCALATE]));
  put(root, 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md', agentBody('privacy-reviewer', 'opus', [AGENT_ESCALATE, AGENT_DENSE_EVIDENCE, AGENT_TIER_BOUNDARY]));
  put(root, 'plugins/researcher/agents/claim-checker.md', agentBody('claim-checker', 'sonnet', [AGENT_ESCALATE, AGENT_REDACT_FULL, AGENT_DENSE_EVIDENCE]));
  put(root, 'plugins/researcher/agents/gatherer.md', agentBody('gatherer', 'haiku', [AGENT_ESCALATE, AGENT_REDACT_FULL]));

  // -- handbook (router index + one page per plugin) --
  put(root, 'docs/handbook/commands/README.md', [
    '# Command Reference (fixture)',
    '',
    'Fixture handbook index for evals/lint-plugins/run.mjs.',
    '',
    '## The task → command router',
    '',
    '| I want to… | Run | Plugin(s) | Notes |',
    '| --- | --- | --- | --- |',
    '| audit the fixture repo | `/code-ops-suite:codebase-audit` | code-ops-suite | fixture row |',
    '| run the fixture orchestrator | `/code-ops-suite:everything` | code-ops-suite | fixture row |',
    '| hunt fixture bugs | `/rigor:bug-hunt` | rigor | fixture row |',
    '| scan fixture quality | `/rigor:quality-scan` | rigor | fixture row |',
    '| close a fixture inconsistency | `/rigor:consistency-closure` | rigor | fixture row |',
    '',
    '## Per-plugin command references',
    '',
    '- [code-ops-suite.md](code-ops-suite.md) — **2 commands**: fixture.',
    '- [rigor.md](rigor.md) — **3 commands**: fixture.',
    '- [privacy-opsec-suite.md](privacy-opsec-suite.md) — **0 commands**: fixture filler.',
    '- [researcher.md](researcher.md) — **0 commands**: fixture filler.',
    '',
  ].join('\n'));
  for (const filler of ['privacy-opsec-suite', 'researcher']) {
    put(root, `docs/handbook/commands/${filler}.md`, `# Command Reference — ${filler} (fixture)\n\nNo commands (fixture filler plugin with 0 skills).\n`);
  }
  put(root, 'docs/handbook/commands/code-ops-suite.md', [
    '# Command Reference — code-ops-suite (fixture)',
    '',
    '### `/code-ops-suite:codebase-audit`',
    'Fixture entry.',
    '',
    '### `/code-ops-suite:everything`',
    'Fixture entry.',
    '',
  ].join('\n'));
  put(root, 'docs/handbook/commands/rigor.md', [
    '# Command Reference — rigor (fixture)',
    '',
    '### `/rigor:bug-hunt`',
    'Fixture entry.',
    '',
    '### `/rigor:quality-scan`',
    'Fixture entry.',
    '',
    '### `/rigor:consistency-closure`',
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
  check('1. baseline banner reports 4 plugins / 5 commands / 5 unique skills', r1.all.includes('OK — 4 plugins, 5 commands (5 unique skills)'));

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
description: "Fixture skill for the lint-plugins regression eval (evals/lint-plugins/run.mjs)."
---

# BUG HUNT (FIXTURE)

Read the bundled CONVENTIONS.md first. This is fixture content; it is not a real skill.
No completion heading here on purpose (case 3 mutation).
`);
  const r3 = runLint(d3);
  check('3. missing Done when exits 1', r3.status === 1);
  check('3. message mentions "Done when"', r3.all.includes('Done when'));

  // 4. ROUTER COUNT — handbook "**N commands**" bullet set to a wrong N (rigor has 3 skills).
  const d4 = clone('case4-router-count');
  const readme4 = readIn(d4, 'docs/handbook/commands/README.md');
  const mutated4 = readme4.replace('- [rigor.md](rigor.md) — **3 commands**: fixture.', '- [rigor.md](rigor.md) — **5 commands**: fixture.');
  check('4. setup: router-count mutation string found', mutated4 !== readme4);
  put(d4, 'docs/handbook/commands/README.md', mutated4);
  const r4 = runLint(d4);
  check('4. wrong router count exits 1', r4.status === 1);
  check('4. message mentions the count', r4.all.includes('**5 commands**') && r4.all.includes('actually has 3'));

  // 5. VENDORED DRIFT — vendored copy diverges from the canonical script.
  const d5 = clone('case5-vendored-drift');
  put(d5, 'plugins/rigor/scripts/fixture-tool.mjs', '// Fixture runtime script for evals/lint-plugins/run.mjs (vendored-script parity check).\nexport const FIXTURE_TOOL = true;\n// drifted on purpose (case 5 mutation)\n');
  const r5 = runLint(d5);
  check('5. vendored drift exits 1', r5.status === 1);
  check('5. message mentions "drifted"', r5.all.includes('drifted'));

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

  // 8. BOGUS COMPOSITION EDGE — docs/techniques/skill-composition.md table cell names a
  // plugin:skill edge that does not resolve to a real plugins/<plugin>/skills/<skill>/ dir.
  const d8 = clone('case8-bogus-composition-edge');
  put(d8, 'docs/techniques/skill-composition.md', [
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

  // 11. STANDARDS-CONTRACT PARITY (check 20) — AGENTS.md drifting from CLAUDE.md. This is
  // the regression that actually happened: the writing-standard section lived in CLAUDE.md
  // alone, so Codex and opencode (which read AGENTS.md) never saw it and nothing complained.
  const d11 = clone('case11-contract-drift');
  put(d11, 'AGENTS.md', '# Fixture standards contract\n\nDrifted on purpose (case 11 mutation).\n');
  const r11 = runLint(d11);
  check('11. a divergent AGENTS.md exits 1', r11.status === 1);
  check('11. message names both files and the fix', r11.all.includes('CLAUDE.md and AGENTS.md have diverged'));

  // 11b. The other half of the contract: a MISSING copy is as bad as a drifted one, since
  // the host reading that name falls back to nothing.
  const d11b = clone('case11b-contract-missing');
  rmSync(join(d11b, 'AGENTS.md'), { force: true });
  const r11b = runLint(d11b);
  check('11b. a missing AGENTS.md exits 1', r11b.status === 1);
  check('11b. message says which hosts lose it', r11b.all.includes('Codex and opencode read it'));

  // 12. COMPOSITION MAP COMPLETENESS (check 22) — the map must match the skill tree in
  // BOTH directions. Case 8 above only exercises check 17 (does a named edge resolve),
  // so every assertion here reads check 22's OWN message text: check 17 can never satisfy
  // it. The fixture plants one real cross-skill reference and the matching edge row, then
  // each mutation breaks one direction.
  const COMP_PATH = 'docs/techniques/skill-composition.md';
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
    '| `rigor:consistency-closure` | `code-ops-suite:everything` | fixture phantom row (case 12b mutation) |',
  ]));
  const r12b = runLint(d12b);
  check('12b. an edge row with no reference exits 1', r12b.status === 1);
  check('12b. message is check 22\'s own "matches no qualified reference"', r12b.all.includes('edge row "rigor:consistency-closure" -> "code-ops-suite:everything" matches no qualified reference'));
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
| \`rigor:consistency-closure\` | \`code-ops-suite:everything\` | phantom row parked outside the edges section (case 12e mutation) |
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
    '| `rigor:consistency-closure` | `code-ops-suite:everything` | example row inside a fence |',
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
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} lint-plugins regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all lint-plugins regression checks passed.');
