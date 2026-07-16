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
//     rigor, privacy-opsec-suite, researcher (~17 sentences shared across most of them),
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

// Builds a MINIMAL tree that scripts/lint-plugins.mjs (copied in, unmodified) passes.
// Two plugins, named/shaped exactly as PRODUCER_SELFCHECK and SHARED_PASSAGES require
// (see the file header note) — 5 skills total, one vendored script, one handbook page
// per plugin plus the router index.
function buildBaseline(root) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(REAL_LINT, join(root, 'scripts', 'lint-plugins.mjs'));
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

  // -- rigor: bug-hunt, quality-scan, consistency-closure (all PRODUCER_SELFCHECK) --
  put(root, 'plugins/rigor/.claude-plugin/plugin.json', JSON.stringify({ name: 'rigor', version: '0.1.0', description: 'fixture rigor plugin' }, null, 2));
  put(root, 'plugins/rigor/CONVENTIONS.md', `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
  put(root, 'plugins/rigor/README.md', '# rigor (fixture)\n\nSkills: bug-hunt, quality-scan, consistency-closure.\n');
  put(root, 'plugins/rigor/skills/bug-hunt/SKILL.md', skillBody('BUG HUNT'));
  put(root, 'plugins/rigor/skills/quality-scan/SKILL.md', skillBody('QUALITY SCAN'));
  put(root, 'plugins/rigor/skills/consistency-closure/SKILL.md', skillBody('CONSISTENCY CLOSURE'));

  // -- privacy-opsec-suite / researcher: bare SHARED_PASSAGES filler, 0 skills each --
  for (const filler of ['privacy-opsec-suite', 'researcher']) {
    put(root, `plugins/${filler}/.claude-plugin/plugin.json`, JSON.stringify({ name: filler, version: '0.1.0', description: `fixture ${filler} plugin (SHARED_PASSAGES filler)` }, null, 2));
    put(root, `plugins/${filler}/CONVENTIONS.md`, `# Conventions (fixture)\n\n${DOCTRINE_BLOB}\n`);
    put(root, `plugins/${filler}/README.md`, `# ${filler} (fixture)\n\nNo skills — SHARED_PASSAGES filler only.\n`);
  }

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
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} lint-plugins regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all lint-plugins regression checks passed.');
