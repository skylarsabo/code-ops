#!/usr/bin/env node
// Distill no-loss and findability regression eval (scripts/distill-check.mjs, `co docs distill`).
//
// Each case builds a temp hub tree, takes the phase 1 inventory, changes the tree the way a distill
// run would, and asks the check for its verdict. The cases pin:
//   - inventory: sorted paths with sizes, byte-identical output on a second run, the output file
//     left out of its own listing, and nothing written outside --out;
//   - no-loss: all in place passes; a moved file with a forwarding entry passes, also through a
//     folder forward; a moved file without one is a loss; a forward to an absent file is a loss; an
//     archived file passes; a link from outside the archive does not archive; a file both forwarded
//     and still present is ambiguous; a doctored inventory count and a repeated path are mismatches;
//     a malformed inventory exits 2;
//   - findability: a linked tree passes; an orphan fails and is named; files under 80 Runs are
//     excluded; wikilinks, encoded links, and links through a reachable note all reach; a link in a
//     code fence does not; --index replaces the defaults and a spec that matches nothing exits 2.
//
// The mutants: each copy of the script breaks one rule, and the case that pins the rule must
// change its verdict. A case no mutant can fail asserts nothing, so this eval fails on one.
//
//   node evals/distill-check/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
const SCRIPT = join(SCRIPTS, 'distill-check.mjs');
const HUB = 'project-docs';
const work = mkdtempSync(join(tmpdir(), 'coh-distill-check-'));
const { fails, check } = tally(withDetail);
let counter = 0;

const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const json = (result) => { try { return JSON.parse(result.out); } catch { return null; } };
const put = (repo, rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const walk = (dir, base = '') => readdirSync(join(dir, base), { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(dir, `${base}${entry.name}/`) : [`${base}${entry.name}`])).sort();

// The base hub. Every note is reachable from `00 Home.md` and `10 Design/INDEX.md`, and the run
// folder holds an unlinked note that findability must leave out.
const BASE = {
  [`${HUB}/00 Home.md`]: '# Home\n\n[A](10%20Design/a.md)\n[Index](10%20Design/INDEX.md)\n[Archive](99%20Archive/README.md)\n',
  [`${HUB}/10 Design/INDEX.md`]: '# Index\n\n[a](a.md)\n[[b]]\n[c](c.md)\n',
  [`${HUB}/10 Design/a.md`]: '# a\n\n[decision](<../20 Decisions/d.md>)\n',
  [`${HUB}/10 Design/b.md`]: '# b\n',
  [`${HUB}/10 Design/c.md`]: '# c\n',
  [`${HUB}/20 Decisions/d.md`]: '# d\n',
  [`${HUB}/80 Runs/2026-09-30 run/notes.md`]: '# run notes\n',
  [`${HUB}/95 Attachments/pic.png`]: 'PNG',
  [`${HUB}/99 Archive/README.md`]: '# Archive\n',
};

// A fresh repository from BASE plus `changes` (a path maps to new text, or to null to delete).
function buildRepo(changes = {}) {
  const repo = join(work, `repo-${counter++}`);
  mkdirSync(repo, { recursive: true });
  const files = { ...BASE, ...changes };
  for (const [path, text] of Object.entries(files)) if (text !== null) put(repo, path, text);
  return repo;
}

const forwarding = (...forwards) => `${JSON.stringify({ version: 1, forwards: forwards.map(([from, to]) => ({ from, to, movedAt: '2026-09-30', reason: 'eval' })) })}\n`;
const FORWARDING = `${HUB}/98 System/FORWARDING.json`;

// Inventory a repository, then apply `after` (path to new text, or null to delete) and run no-loss.
function noLoss(script, { before = {}, after = {}, tamper = null, args = [] }) {
  const repo = buildRepo(before);
  const inventory = join(work, `inventory-${counter++}.json`);
  const made = run(script, ['inventory', '--root', repo, '--hub', HUB, '--out', inventory]);
  if (made.status !== 0) throw new Error(`inventory failed: ${made.all}`);
  for (const [path, text] of Object.entries(after)) {
    if (text === null) rmSync(join(repo, path), { force: true }); else put(repo, path, text);
  }
  if (tamper) writeFileSync(inventory, tamper(readFileSync(inventory, 'utf8')));
  const result = run(script, ['no-loss', '--root', repo, '--inventory', inventory, '--json', ...args]);
  return { ...result, report: json(result) };
}

function findability(script, changes = {}, args = []) {
  const result = run(script, ['findability', '--root', buildRepo(changes), '--hub', HUB, '--json', ...args]);
  return { ...result, report: json(result) };
}

const MOVED = `${HUB}/10 Design/b.md`;
const MOVED_TO = `${HUB}/10 Design/sub/b.md`;
const archiveNote = (target) => `# Archive\n\n[gone](${target})\n`;

// Cases that a mutant can break: name, how to run, and what a correct script answers.
const CASES = {
  inPlace: { run: (script) => noLoss(script, {}), holds: (r) => r.status === 0 && r.report?.ok && r.report.inputs === 9 && r.report.accounted === 9 && r.report.counts['in-place'] === 9 },
  moved: { run: (script) => noLoss(script, { after: { [MOVED]: null, [MOVED_TO]: '# b\n', [FORWARDING]: forwarding([MOVED, MOVED_TO]) } }), holds: (r) => r.status === 0 && r.report?.counts.moved === 1 && r.report.counts['in-place'] === 8 },
  movedByFolder: { run: (script) => noLoss(script, { after: { [`${HUB}/10 Design/a.md`]: null, [`${HUB}/10 Design/b.md`]: null, [`${HUB}/10 Design/c.md`]: null, [`${HUB}/10 Design/INDEX.md`]: null, [`${HUB}/Design/a.md`]: '# a\n', [`${HUB}/Design/b.md`]: '# b\n', [`${HUB}/Design/c.md`]: '# c\n', [`${HUB}/Design/INDEX.md`]: '# i\n', [FORWARDING]: forwarding([`${HUB}/10 Design`, `${HUB}/Design`]) } }), holds: (r) => r.status === 0 && r.report?.counts.moved === 4 },
  movedNoEntry: { run: (script) => noLoss(script, { after: { [MOVED]: null, [MOVED_TO]: '# b\n' } }), holds: (r) => r.status === 1 && r.report?.lost.join() === MOVED },
  forwardToAbsent: { run: (script) => noLoss(script, { after: { [MOVED]: null, [FORWARDING]: forwarding([MOVED, MOVED_TO]) } }), holds: (r) => r.status === 1 && r.report?.lost.join() === MOVED },
  archived: { run: (script) => noLoss(script, { after: { [`${HUB}/10 Design/c.md`]: null, [`${HUB}/99 Archive/README.md`]: archiveNote('../10%20Design/c.md') } }), holds: (r) => r.status === 0 && r.report?.counts.archived === 1 },
  archivedByWikilink: { run: (script) => noLoss(script, { after: { [`${HUB}/10 Design/c.md`]: null, [`${HUB}/99 Archive/README.md`]: '# Archive\n\n[[10 Design/c]]\n' } }), holds: (r) => r.status === 0 && r.report?.counts.archived === 1 },
  archiveLinkOutsideArchive: { run: (script) => noLoss(script, { after: { [`${HUB}/10 Design/c.md`]: null } }), holds: (r) => r.status === 1 && r.report?.lost.join() === `${HUB}/10 Design/c.md` },
  ambiguous: { run: (script) => noLoss(script, { after: { [MOVED_TO]: '# b\n', [FORWARDING]: forwarding([MOVED, MOVED_TO]) } }), holds: (r) => r.status === 1 && r.report?.ambiguous.length === 1 && r.report.ambiguous[0].path === MOVED && r.report.ambiguous[0].states.join() === 'in-place,moved' },
  countMismatch: { run: (script) => noLoss(script, { tamper: (text) => text.replace('"count": 9', '"count": 8') }), holds: (r) => r.status === 1 && r.report?.problems.some((p) => /declares 8 file\(s\) and lists 9/.test(p)) },
  repeatedPath: { run: (script) => noLoss(script, { tamper: (text) => { const doc = JSON.parse(text); doc.files.push(doc.files[0]); doc.count = doc.files.length; return JSON.stringify(doc); } }), holds: (r) => r.status === 1 && r.report?.inputs === 10 && r.report.accounted === 9 && r.report.problems.some((p) => /inputs 10 differ from accounted 9/.test(p)) },
  orphan: { run: (script) => findability(script, { [`${HUB}/10 Design/orphan.md`]: '# orphan\n' }), holds: (r) => r.status === 1 && r.report?.unreachable === 1 && r.report.unreachablePaths.join() === `${HUB}/10 Design/orphan.md` },
  linked: { run: (script) => findability(script), holds: (r) => r.status === 0 && r.report?.unreachable === 0 && r.report.notes === 7 },
  runsExcluded: { run: (script) => findability(script, { [`${HUB}/80 Runs/2026-09-30 run/more.md`]: '# more\n' }), holds: (r) => r.status === 0 && r.report?.notes === 7 },
};

// Each mutant breaks one rule. `replace` maps an exact source string to its replacement, and the
// pinned case must stop holding.
const MUTANTS = [
  { name: 'ignores FORWARDING.json', replace: ['moved !== null && present(moved)', 'false'], pins: ['moved', 'movedByFolder'] },
  { name: 'accepts a path in two states', replace: ['states.length > 1) ambiguous.push({ path, states });', 'states.length > 1) counts[states[0]]++;'], pins: ['ambiguous'] },
  { name: 'counts any link as an archive link', replace: ['const folder = `${hub}/${ARCHIVE_FOLDER}`;', 'const folder = hub;'], pins: ['archiveLinkOutsideArchive'] },
  { name: 'trusts the declared inventory count', replace: ['inventory.count !== inputs', 'false'], pins: ['countMismatch'] },
  { name: 'drops the inputs = accounted check', replace: ['inputs !== accounted', 'false'], pins: ['repeatedPath'] },
  { name: 'reports no unreachable note', replace: ['const unreachable = notes.filter((path) => !reached.has(path));', 'const unreachable = [];'], pins: ['orphan'] },
  { name: 'lists 80 Runs in findability', replace: ['{ skipFolder: `${hub}/${RUNS_FOLDER}` }', '{}'], pins: ['runsExcluded'] },
];

function mutantScript(index, [from, to]) {
  const source = readFileSync(SCRIPT, 'utf8');
  if (!source.includes(from)) throw new Error(`mutant anchor not found in distill-check.mjs: ${from}`);
  const sibling = (name) => pathToFileURL(join(SCRIPTS, name)).href;
  const mutated = source.replace(from, () => to).replace(/from '\.\/([\w-]+\.mjs)'/g, (_, name) => `from '${sibling(name)}'`);
  const file = join(work, `mutant-${index}.mjs`);
  writeFileSync(file, mutated);
  return file;
}

try {
  // inventory
  const repo = buildRepo();
  const before = walk(repo);
  const out = join(work, 'inventory-main.json');
  const first = run(SCRIPT, ['inventory', '--root', repo, '--hub', HUB, '--out', out]);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  const paths = doc.files.map((file) => file.path);
  check('inventory exits 0 and reports its count', first.status === 0 && /9 file\(s\)/.test(first.out) && doc.count === 9, first.all);
  check('inventory paths are repo-relative, forward-slash, and sorted', paths[0] === `${HUB}/00 Home.md` && paths.every((p) => !p.includes('\\')) && paths.join('\n') === [...paths].sort().join('\n'));
  check('inventory lists the run folder and records sizes', paths.includes(`${HUB}/80 Runs/2026-09-30 run/notes.md`) && doc.files.find((f) => f.path === `${HUB}/95 Attachments/pic.png`)?.size === 3 && doc.totalBytes === doc.files.reduce((s, f) => s + f.size, 0));
  check('inventory writes nothing outside --out', walk(repo).join() === before.join());
  const inside = join(repo, HUB, '98 System', 'inventory.json');
  run(SCRIPT, ['inventory', '--root', repo, '--hub', HUB, '--out', inside]);
  const firstBytes = readFileSync(inside, 'utf8');
  run(SCRIPT, ['inventory', '--root', repo, '--hub', HUB, '--out', inside]);
  check('inventory is byte-identical on a second run and leaves its own output out', readFileSync(inside, 'utf8') === firstBytes && !JSON.parse(firstBytes).files.some((f) => f.path.endsWith('98 System/inventory.json')));
  const noHub = run(SCRIPT, ['inventory', '--root', repo, '--hub', 'absent-hub', '--out', out]);
  check('inventory of a missing hub exits 2', noHub.status === 2, noHub.all);

  // no-loss and findability against the real script
  for (const [name, entry] of Object.entries(CASES)) {
    const result = entry.run(SCRIPT);
    check(`case ${name}`, entry.holds(result), result.all);
  }
  const text = run(SCRIPT, ['no-loss', '--root', buildRepo(), '--inventory', out]);
  check('no-loss prints the per-state counts and inputs = accounted', text.status === 0 && /inputs 9 = accounted 9/.test(text.out) && /in-place: 9/.test(text.out) && /moved: 0/.test(text.out) && /archived: 0/.test(text.out), text.all);
  const lossText = run(SCRIPT, ['no-loss', '--root', buildRepo({ [`${HUB}/10 Design/c.md`]: null }), '--inventory', out]);
  check('no-loss prints each loss and exits 1', lossText.status === 1 && lossText.out.includes(`LOSS ${HUB}/10 Design/c.md`), lossText.all);
  const bad = join(work, 'bad-inventory.json');
  writeFileSync(bad, '{"version":9}');
  const malformed = run(SCRIPT, ['no-loss', '--root', buildRepo(), '--inventory', bad]);
  check('a malformed inventory exits 2', malformed.status === 2, malformed.all);
  const invalidForwarding = noLoss(SCRIPT, { after: { [FORWARDING]: '{"version":1,"forwards":[{"from":"x"}]}' } });
  check('an invalid FORWARDING.json exits 2', invalidForwarding.status === 2, invalidForwarding.all);

  const textFind = run(SCRIPT, ['findability', '--root', buildRepo({ [`${HUB}/10 Design/orphan.md`]: '# orphan\n' }), '--hub', HUB]);
  check('findability prints the count and each unreachable path', textFind.status === 1 && /1 unreachable/.test(textFind.out) && textFind.out.includes(`UNREACHABLE ${HUB}/10 Design/orphan.md`), textFind.all);
  const throughNote = findability(SCRIPT, { [`${HUB}/10 Design/deep.md`]: '# deep\n', [`${HUB}/10 Design/b.md`]: '# b\n\n[deep](deep.md)\n' });
  check('findability follows links through a reachable note', throughNote.status === 0 && throughNote.report.notes === 8, throughNote.all);
  const encoded = findability(SCRIPT, { [`${HUB}/10 Design/the note.md`]: '# the note\n', [`${HUB}/10 Design/INDEX.md`]: '# Index\n\n[a](a.md)\n[[b]]\n[c](c.md)\n[n](the%20note.md)\n' });
  check('findability reads an encoded link', encoded.status === 0 && encoded.report.notes === 8, encoded.all);
  const fenced = findability(SCRIPT, { [`${HUB}/10 Design/hidden.md`]: '# hidden\n', [`${HUB}/10 Design/INDEX.md`]: '# Index\n\n[a](a.md)\n[[b]]\n[c](c.md)\n\n```md\n[hidden](hidden.md)\n```\n\nSee `[[hidden]]`.\n' });
  check('a link in a code fence or code span does not reach', fenced.status === 1 && fenced.report.unreachablePaths.join() === `${HUB}/10 Design/hidden.md`, fenced.all);
  const narrow = findability(SCRIPT, {}, ['--index', `${HUB}/10 Design/INDEX.md`]);
  check('--index replaces the default roots', narrow.status === 1 && narrow.report.indexRoots.join() === `${HUB}/10 Design/INDEX.md` && narrow.report.unreachablePaths.includes(`${HUB}/00 Home.md`), narrow.all);
  const globbed = findability(SCRIPT, {}, ['--index', `${HUB}/*/INDEX.md`, '--index', `${HUB}/00 Home.md`]);
  check('--index takes a glob and repeats', globbed.status === 0 && globbed.report.indexRoots.length === 2, globbed.all);
  const none = findability(SCRIPT, {}, ['--index', `${HUB}/nowhere/*.md`]);
  check('an --index spec that matches nothing exits 2', none.status === 2, none.all);
  const rootless = findability(SCRIPT, { [`${HUB}/00 Home.md`]: null, [`${HUB}/10 Design/INDEX.md`]: null });
  check('a hub with no index root exits 2', rootless.status === 2, rootless.all);
  const runsIndex = findability(SCRIPT, {}, ['--index', `${HUB}/80 Runs/2026-09-30 run/notes.md`]);
  check('--index cannot seed from 80 Runs', runsIndex.status === 2, runsIndex.all);

  // the CLI surface
  const usage = run(SCRIPT, ['bogus']);
  check('an unknown subcommand exits 2 with usage', usage.status === 2 && /usage: distill-check\.mjs/.test(usage.err), usage.all);
  const facade = run(join(SCRIPTS, 'co.mjs'), ['docs', 'distill', 'findability', '--root', buildRepo(), '--hub', HUB]);
  check('co docs distill reaches the script', facade.status === 0 && /distill findability: 7 note\(s\)/.test(facade.out), facade.all);

  // mutants
  for (const [index, mutant] of MUTANTS.entries()) {
    const script = mutantScript(index, mutant.replace);
    for (const name of mutant.pins) {
      check(`mutant "${mutant.name}" fails case ${name}`, !CASES[name].holds(CASES[name].run(script)));
    }
    check(`mutant "${mutant.name}" still passes the all-in-place case`, CASES.inPlace.holds(CASES.inPlace.run(script)));
  }
} catch (error) {
  check('eval ran to completion', false, error.stack);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} distill check(s) failed:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: distill check regression eval passed.');
