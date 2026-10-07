#!/usr/bin/env node
// Direction gap-link check regression eval (scripts/check-gap-link.mjs).
//
//   node evals/direction-alignment/run.mjs   (exit 0 = pass)
//
// The check is advisory: a body that links a gap-table row is accepted, and a body with no link
// gets a note. Neither outcome may fail. Cases cover the parser, the CLI against fixture bodies,
// the real direction note's table, and the CI wiring.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DOC, assess, gapIds, gapLinks } from '../../scripts/check-gap-link.mjs';
import { tally } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { fails, check } = tally();
const cli = join(ROOT, 'scripts', 'check-gap-link.mjs');

const DOC = ['| Id | Gap | Status | Friction |', '| --- | --- | --- | --- |',
  '| G1 | One | open | - |', '| G2 | Two | shipped | - |', '| G10 | Ten | open | - |', '| not a row | x | y | z |'].join('\n');
const IDS = ['G1', 'G2', 'G10'];

// ---- 1. the parser ------------------------------------------------------------------------
check('table ids come from the first cell', JSON.stringify(gapIds(DOC)) === JSON.stringify(IDS), JSON.stringify(gapIds(DOC)));
check('header and separator rows are not ids', !gapIds(DOC).includes('Id'));
check('Gap: line links', JSON.stringify(gapLinks('Closes it.\nGap: G2\n')) === '["G2"]');
check('Gap: comma list links each id', JSON.stringify(gapLinks('Gap: G1, g10')) === '["G1","G10"]');
check('wikilink anchor links', JSON.stringify(gapLinks('See [[Suite direction 2026-08#G1]].')) === '["G1"]');
check('file-name anchor links', JSON.stringify(gapLinks('(Suite direction 2026-08.md#g2)')) === '["G2"]');
check('both forms de-duplicate', JSON.stringify(gapLinks('Gap: G1\n[[Suite direction 2026-08#G1]]')) === '["G1"]');
check('prose about a gap is not a link', gapLinks('This closes a gap in G1 coverage.').length === 0);
check('a link without an id is not a link', gapLinks('[[Suite direction 2026-08]] and Gap: none').length === 0);
check('G1 does not match inside G10', JSON.stringify(gapLinks('Gap: G10')) === '["G10"]');

check('known link is ok', assess('Gap: G2', IDS).ok === true);
check('no link is not ok and says so', (() => { const r = assess('Fix a typo.', IDS); return !r.ok && /links no gap row/.test(r.note); })());
check('empty body is not ok', assess('', IDS).ok === false);
check('unknown id is not ok and is named', (() => { const r = assess('Gap: G99', IDS); return !r.ok && r.unknown[0] === 'G99' && /G99/.test(r.note); })());
check('one known id among unknown ids is ok', (() => { const r = assess('Gap: G2, G99', IDS); return r.ok && r.unknown[0] === 'G99'; })());

// ---- 2. the CLI against fixture bodies ----------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'code-ops-gap-link-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const doc = join(work, 'direction.md');
writeFileSync(doc, DOC);
const body = (name, text) => { const p = join(work, name); writeFileSync(p, text); return p; };
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });

const linked = run(body('linked.md', 'Add the thing.\n\nGap: G2\n'), '--doc', doc);
check('body with a gap link is accepted, exit 0', linked.status === 0 && /gap link accepted \(G2\)/.test(linked.stdout) && !/Advisory/.test(linked.stdout), linked.stdout + linked.stderr);
const wiki = run(body('wiki.md', 'Add the thing, see [[Suite direction 2026-08#G10]].'), '--doc', doc);
check('wikilink body is accepted, exit 0', wiki.status === 0 && /accepted \(G10\)/.test(wiki.stdout), wiki.stdout);
const bare = run(body('bare.md', 'Add the thing.\n'), '--doc', doc);
check('body without a link emits the advisory, exit 0', bare.status === 0 && /Advisory: the body links no gap row/.test(bare.stdout) && /Gap: G1/.test(bare.stdout), bare.stdout + bare.stderr);
const unknown = run(body('unknown.md', 'Gap: G99'), '--doc', doc);
check('body with an unknown id emits the advisory, exit 0', unknown.status === 0 && /G99, which the gap table does not list/.test(unknown.stdout), unknown.stdout);
const empty = run(body('empty.md', ''), '--doc', doc);
check('empty body emits the advisory, exit 0', empty.status === 0 && /Advisory/.test(empty.stdout));
const missingBody = run(join(work, 'absent.md'), '--doc', doc);
check('missing body file reads as an empty body, exit 0', missingBody.status === 0 && /Advisory/.test(missingBody.stdout));
const noDoc = run(body('x.md', 'x'), '--doc', join(work, 'no-such-note.md'));
check('missing direction note skips, exit 0', noDoc.status === 0 && /skipped/.test(noDoc.stdout) && !/Advisory/.test(noDoc.stdout), noDoc.stdout);
const noTable = (() => { const p = join(work, 'plain.md'); writeFileSync(p, '# A note with no table\n'); return run(body('y.md', 'Gap: G1'), '--doc', p); })();
check('direction note without a table skips, exit 0', noTable.status === 0 && /no gap table/.test(noTable.stdout));
const annotated = spawnSync(process.execPath, [cli, body('ann.md', 'none'), '--doc', doc], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
check('CI run adds a notice annotation, never an error', annotated.status === 0 && /^::notice title=Direction gap link::/m.test(annotated.stdout) && !/::(error|warning)/.test(annotated.stdout), annotated.stdout);
check('usage error exits 2', run().status === 2 && run('a', 'b').status === 2 && run('--bogus').status === 2 && run('a', '--doc').status === 2);

// ---- 3. the real direction note and the CI wiring -----------------------------------------
const real = readFileSync(DEFAULT_DOC, 'utf8');
const realIds = gapIds(real);
check('the direction note holds ten gap rows G1 to G10', JSON.stringify(realIds) === JSON.stringify(Array.from({ length: 10 }, (_, i) => `G${i + 1}`)), JSON.stringify(realIds));
check('every gap row carries a Status and a Friction cell', real.split('\n').filter((l) => /^\|\s*G\d+\s*\|/.test(l)).every((l) => l.split('|').length === 6 && /\|\s*(open|partial|shipped)\b/.test(l)));
check('the table header names Status and Friction', /^\| Id \| Gap \| Status \| Friction \|$/m.test(real));
check('the real note accepts its own row link', run(body('real.md', 'Gap: G4'), '--doc', DEFAULT_DOC).stdout.includes('accepted (G4)'));

const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8');
const gapStep = workflow.split('\n      - name: ').find((s) => s.startsWith('Direction gap link')) || '';
check('CI step exists, runs on pull requests only', /^Direction gap link \(advisory\)\n\s+if: github\.event_name == 'pull_request'/.test(gapStep), gapStep.slice(0, 120));
check('CI passes the body through env and runs the CLI on the file', /PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/.test(gapStep) && gapStep.includes('node scripts/check-gap-link.mjs "$pr_body"'));
check('CI never inlines the body in a script', !/run:[\s\S]*\$\{\{ github\.event\.pull_request\.body/.test(gapStep));
check('the advisory step cannot mask or fail the step', !/continue-on-error|\|\| true/.test(gapStep));
check('the eval runs once per platform', (workflow.match(/node evals\/direction-alignment\/run\.mjs/g) || []).length === 2);

if (fails.length) {
  console.error('FAIL — direction-alignment eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — direction-alignment eval: a gap link is accepted, a missing or unknown link gets an advisory, and nothing fails.');
