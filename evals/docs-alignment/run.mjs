#!/usr/bin/env node
// Regression eval for scripts/check-docs-standards-alignment.mjs, the gate that every house
// standard page is named by AGENTS.md, a CONVENTIONS.md, or a skill or agent, and that every
// standard those files name exists. The gate normally runs only against the live tree, so a
// regression that stops it listing the folder, narrows a citing file, or turns a finding into
// a pass stays invisible unless the live tree happens to break that exact rule. This eval
// spawns the real, unmodified script against small fixture trees, asserts it fails closed on
// each broken one, and stays clean on the baseline and on the live tree.
//
//   node evals/docs-alignment/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(REPO, 'scripts', 'check-docs-standards-alignment.mjs');
const TECHNIQUES = 'code-ops-docs/40 Engineering/Techniques';

const { fails, check } = tally();

const put = (root, relPath, content = '\n') => {
  const full = join(root, ...relPath.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

// Spawns the real script on a root; the fixture needs no copy because the gate takes --root.
const run = (...args) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8', timeout: 15000 });
  return { status: r.status, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// The baseline: one standard named by AGENTS.md, one by a CONVENTIONS.md, one by a skill, one
// by an agent. Each is a real citing surface of the live repo, and the fixture plugin is not
// one of the four real names, so the gate must discover plugins rather than list them.
function buildBaseline(root) {
  for (const name of ['alpha', 'beta', 'gamma', 'delta']) put(root, `${TECHNIQUES}/${name}-standard.md`, `# ${name}\n`);
  put(root, `${TECHNIQUES}/notes.md`, '# A technique page that is not a standard.\n');
  put(root, 'AGENTS.md', 'The alpha standard lives in `code-ops-docs/40 Engineering/Techniques/alpha-standard.md`.\n');
  put(root, 'plugins/fixture-plugin/CONVENTIONS.md', 'See [`beta-standard.md`](https://example.test/Techniques/beta-standard.md) for the rule.\n');
  put(root, 'plugins/fixture-plugin/skills/one/SKILL.md', 'Read `<plugin-root>/reference/gamma-standard.md` first.\n');
  put(root, 'plugins/fixture-plugin/agents/helper.md', 'Follow delta-standard.md for report prose.\n');
}

const work = mkdtempSync(join(tmpdir(), 'docs-alignment-'));
let caseNo = 0;
const fixture = (mutate) => {
  const dir = join(work, `case${++caseNo}`);
  buildBaseline(dir);
  mutate?.(dir);
  return dir;
};

try {
  // 0. the live tree
  const live = run();
  check('0. the live tree is aligned', live.status === 0, live.all.trim());

  // 1. the baseline passes, so every later failure comes from its own mutation
  const base = run('--root', fixture());
  check('1a. the baseline fixture exits 0', base.status === 0, base.all.trim());
  check('1b. the pass line is printed', base.all.includes('every standard is named and every named standard exists'));

  // 2. a new standard that nothing names fails, and the finding names the page
  const newPage = run('--root', fixture((d) => put(d, `${TECHNIQUES}/omega-standard.md`, '# omega\n')));
  check('2a. an unnamed new standard exits 1', newPage.status === 1);
  check('2b. the finding names the page', newPage.all.includes(`${TECHNIQUES}/omega-standard.md is named by no AGENTS.md`));
  check('2c. the named standards raise no finding', !newPage.all.includes('alpha-standard') && !newPage.all.includes('delta-standard'));

  // 3. each citing surface alone counts: dropping the only name of a standard fails
  const dropAgents = run('--root', fixture((d) => put(d, 'AGENTS.md', 'No standard is named here.\n')));
  check('3a. a standard only AGENTS.md named fails once AGENTS.md drops it', dropAgents.status === 1 && dropAgents.all.includes('alpha-standard.md is named by no'));
  const dropConventions = run('--root', fixture((d) => put(d, 'plugins/fixture-plugin/CONVENTIONS.md', 'Nothing cited.\n')));
  check('3b. the same holds for CONVENTIONS.md', dropConventions.status === 1 && dropConventions.all.includes('beta-standard.md is named by no'));
  const dropSkill = run('--root', fixture((d) => put(d, 'plugins/fixture-plugin/skills/one/SKILL.md', 'Nothing cited.\n')));
  check('3c. the same holds for a skill', dropSkill.status === 1 && dropSkill.all.includes('gamma-standard.md is named by no'));
  const dropAgent = run('--root', fixture((d) => put(d, 'plugins/fixture-plugin/agents/helper.md', 'Nothing cited.\n')));
  check('3d. the same holds for an agent', dropAgent.status === 1 && dropAgent.all.includes('delta-standard.md is named by no'));

  // 4. a citation of a page that does not exist fails and names the citing file
  const dangling = run('--root', fixture((d) => put(d, 'AGENTS.md', 'Read alpha-standard.md and zeta-standard.md.\n')));
  check('4a. a cited standard with no page exits 1', dangling.status === 1);
  check('4b. the finding names the citing file and the page', dangling.all.includes('AGENTS.md names zeta-standard.md, which is not a page in'));
  const danglingPlugin = run('--root', fixture((d) => put(d, 'plugins/fixture-plugin/skills/one/SKILL.md', 'Read gamma-standard.md and eta-standard.md.\n')));
  check('4c. a dangling citation in a skill names the skill', danglingPlugin.status === 1 && danglingPlugin.all.includes('plugins/fixture-plugin/skills/one/SKILL.md names eta-standard.md'));

  // 5. only a bare `.md` page name is a citation
  const lookalikes = run('--root', fixture((d) => put(d, 'AGENTS.md',
    'Read alpha-standard.md. The script check-theta-standard.mjs, the file kappa-standard.mdx, and Zeta_standard.md are not pages.\n')));
  check('5. a script name, a longer extension, and an underscore name raise no finding', lookalikes.status === 0, lookalikes.all.trim());

  // 6. a plugin discovered from the folder is scanned, whatever its name
  const newPlugin = run('--root', fixture((d) => put(d, 'plugins/zz-new/skills/two/SKILL.md', 'Cites iota-standard.md.\n')));
  check('6. a citation in an undeclared plugin is read', newPlugin.status === 1 && newPlugin.all.includes('plugins/zz-new/skills/two/SKILL.md names iota-standard.md'));

  // 7. fail closed on a missing input
  const noFolder = run('--root', fixture((d) => rmSync(join(d, ...TECHNIQUES.split('/')), { recursive: true })));
  check('7a. a missing standards folder exits 1', noFolder.status === 1 && noFolder.all.includes(`missing standards folder: ${TECHNIQUES}`));
  const noContract = run('--root', fixture((d) => rmSync(join(d, 'AGENTS.md'))));
  check('7b. a missing AGENTS.md exits 1', noContract.status === 1 && noContract.all.includes('missing AGENTS.md'));
  const noPlugins = run('--root', fixture((d) => rmSync(join(d, 'plugins'), { recursive: true })));
  check('7c. a missing plugins folder exits 1', noPlugins.status === 1 && noPlugins.all.includes('missing plugins/ folder'));

  // 8. usage
  check('8a. an unknown flag exits 2', run('--bogus').status === 2);
  check('8b. --root without a value exits 2', run('--root').status === 2);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} docs-alignment check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all docs-alignment checks passed.');
