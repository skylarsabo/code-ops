#!/usr/bin/env node
// Build-graph regression eval: pins scripts/build-graph.mjs.
//   - a clean graph passes `check` (stdout `ok`, exit 0) and `plan` prints its waves;
//   - every failure rule exits 1 and names its problem on stderr: bad JSON, schema errors,
//     duplicate ids, unknown dependencies, cycles, unordered path sharing, empty doneWhen or gate,
//     a bad roundBudget, and generated or stamped scope paths;
//   - every pass boundary holds: an ordered pair may share a path, transitively and in either
//     direction, units in different repos may share a path, and the hand-bumped version files are
//     not generated;
//   - `plan` refuses a bad graph, and a bad usage exits 2;
//   - MUTANTS: each source mutation below must make the case suite fail, so a rule cannot be
//     weakened without this eval noticing.
//
//   node evals/build-graph/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(root, 'scripts');
const { fails, expect, check } = tally();

const unit = (id, extra = {}) => ({ id, repo: 'r', scope: [`src/${id.toLowerCase()}`], dependsOn: [], doneWhen: 'tests pass', gate: 'node test.mjs', roundBudget: 40, ...extra });
const graph = (units, extra = {}) => ({ version: 1, program: 'p', units, ...extra });
const base = () => graph([unit('A'), unit('B', { dependsOn: ['A'] }), unit('C')]);

// Each case: graph (object or raw text), expected exit code, and a substring of stderr (fail) or stdout (pass).
const CASES = [
  ['clean graph', base(), 0, 'ok'],
  ['invalid JSON', '{ not json', 1, 'invalid JSON'],
  ['version not 1', graph([unit('A')], { version: 2 }), 1, 'version must be 1'],
  ['missing program', graph([unit('A')], { program: '' }), 1, 'program must be'],
  ['unknown top key', graph([unit('A')], { extra: 1 }), 1, 'unknown key: extra'],
  ['empty units', graph([]), 1, 'units must be'],
  ['unknown unit key', graph([unit('A', { color: 'red' })]), 1, 'unknown key: color'],
  ['duplicate id', graph([unit('A'), unit('A', { scope: ['src/other'] })]), 1, 'duplicate id A'],
  ['unknown dependency', graph([unit('A', { dependsOn: ['Z'] })]), 1, 'unknown dependency Z'],
  ['self dependency', graph([unit('A', { dependsOn: ['A'] })]), 1, 'dependency cycle'],
  ['two-unit cycle', graph([unit('A', { dependsOn: ['B'] }), unit('B', { dependsOn: ['A'] })]), 1, 'dependency cycle among: A, B'],
  ['unordered same path', graph([unit('A', { scope: ['src/x.mjs'] }), unit('B', { scope: ['src/x.mjs'] })]), 1, 'units A and B share src/x.mjs'],
  ['unordered directory over file', graph([unit('A', { scope: ['src'] }), unit('B', { scope: ['src/deep/x.mjs'] })]), 1, 'share src/deep/x.mjs'],
  ['file under directory, reverse order', graph([unit('A', { scope: ['src/deep/x.mjs'] }), unit('B', { scope: ['src'] })]), 1, 'share'],
  ['case and slash fold', graph([unit('A', { scope: ['Src\\Deep/X.mjs'] }), unit('B', { scope: ['./src/deep/x.mjs'] })]), 1, 'share src/deep/x.mjs'],
  ['trailing slash directory', graph([unit('A', { scope: ['src/'] }), unit('B', { scope: ['src/x.mjs'] })]), 1, 'share'],
  ['order only through a sibling', graph([unit('A', { scope: ['s/x'] }), unit('B', { scope: ['s/y'], dependsOn: ['A'] }), unit('C', { scope: ['s/x'] })]), 1, 'units A and C share'],
  ['glob scope beside a file', graph([unit('A', { scope: ['scripts/**'] }), unit('B', { scope: ['scripts/co.mjs'] })]), 1, 'unit A: scope path scripts/** is a glob'],
  ['glob question mark', graph([unit('A', { scope: ['src/a?.mjs'] })]), 1, 'is a glob'],
  ['glob bracket', graph([unit('A', { scope: ['src/[ab].mjs'] })]), 1, 'is a glob'],
  ['mid-path dot segment', graph([unit('A', { scope: ['evals/./x/run.mjs'] }), unit('B', { scope: ['evals/x/run.mjs'] })]), 1, 'unit A: scope path evals/./x/run.mjs has a `.` segment'],
  ['empty segment', graph([unit('A', { scope: ['src//x.mjs'] })]), 1, 'unit A: scope path src//x.mjs has an empty segment'],
  ['empty segment, backslashes', graph([unit('A', { scope: ['src\\\\x.mjs'] })]), 1, 'has an empty segment'],
  ['pass: leading dot-slash and trailing slash', graph([unit('A', { scope: ['./src/'] })]), 0, 'ok'],
  ['empty doneWhen', graph([unit('A', { doneWhen: '  ' })]), 1, 'doneWhen must be'],
  ['missing doneWhen', graph([(({ doneWhen, ...rest }) => rest)(unit('A'))]), 1, 'doneWhen must be'],
  ['empty gate', graph([unit('A', { gate: '' })]), 1, 'gate must be'],
  ['missing gate', graph([(({ gate, ...rest }) => rest)(unit('A'))]), 1, 'gate must be'],
  ['roundBudget zero', graph([unit('A', { roundBudget: 0 })]), 1, 'roundBudget must be a positive integer'],
  ['roundBudget negative', graph([unit('A', { roundBudget: -3 })]), 1, 'roundBudget must be'],
  ['roundBudget fraction', graph([unit('A', { roundBudget: 2.5 })]), 1, 'roundBudget must be'],
  ['roundBudget string', graph([unit('A', { roundBudget: '40' })]), 1, 'roundBudget must be'],
  ['empty scope', graph([unit('A', { scope: [] })]), 1, 'scope must be'],
  ['scope escapes repo', graph([unit('A', { scope: ['../other/x'] })]), 1, 'must stay inside'],
  ['absolute scope', graph([unit('A', { scope: ['/etc/x'] })]), 1, 'must stay inside'],
  ['generated: first host distribution', graph([unit('A', { scope: ['host-marketplace/foo/x.json'.replace('host', 'cod' + 'ex')] })]), 1, 'generated or stamped'],
  ['generated: opencode-dist dir', graph([unit('A', { scope: ['opencode-dist'] })]), 1, 'generated or stamped'],
  ['generated: agents marketplace', graph([unit('A', { scope: ['.agents/plugins/marketplace.json'] })]), 1, 'generated or stamped'],
  ['generated: docs manifest', graph([unit('A', { scope: ['code-ops-docs/98 System/DOCS_MANIFEST.json'] })]), 1, 'generated or stamped'],
  ['generated: docs manifest, folded case', graph([unit('A', { scope: ['code-ops-docs/98 system/docs_manifest.json'] })]), 1, 'generated or stamped'],
  ['generated: digests dir', graph([unit('A', { scope: ['code-ops-docs/98 System/Digests'] })]), 1, 'generated or stamped'],
  ['generated: digest file', graph([unit('A', { scope: ['code-ops-docs/98 System/Digests/x.json'] })]), 1, 'generated or stamped'],
  ['generated: global contract render', graph([unit('A', { scope: ['global-contracts/AGENTS.grok.md'] })]), 1, 'generated or stamped'],
  ['generated: vendored copy', graph([unit('A', { scope: ['plugins/code-ops-suite/scripts/co.mjs'] })]), 1, 'generated or stamped'],
  ['generated: vendored dir', graph([unit('A', { scope: ['plugins/code-ops-suite/scripts'] })]), 1, 'generated or stamped'],
  // Pass boundaries.
  ['pass: direct order may share', graph([unit('A', { scope: ['s/x'] }), unit('B', { scope: ['s/x'], dependsOn: ['A'] })]), 0, 'ok'],
  ['pass: transitive order may share', graph([unit('A', { scope: ['s'] }), unit('B', { scope: ['t'], dependsOn: ['A'] }), unit('C', { scope: ['s/x'], dependsOn: ['B'] })]), 0, 'ok'],
  ['pass: reverse-listed order may share', graph([unit('C', { scope: ['s/x'], dependsOn: ['A'] }), unit('A', { scope: ['s'] })]), 0, 'ok'],
  ['pass: different repos may share', graph([unit('A', { scope: ['s/x'] }), unit('B', { scope: ['s/x'], repo: 'other' })]), 0, 'ok'],
  ['pass: sibling prefix is not overlap', graph([unit('A', { scope: ['src/ab'] }), unit('B', { scope: ['src/abc'] })]), 0, 'ok'],
  ['pass: authored script and the global source', graph([unit('A', { scope: ['scripts/build-graph.mjs', 'global-contracts/AGENTS.source.md'] })]), 0, 'ok'],
  ['pass: plugin version files are authored', graph([unit('A', { scope: ['plugins/code-ops-suite/.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'] })]), 0, 'ok'],
];

// Run every case against a build-graph.mjs; return the cases it got wrong.
function suite(dir) {
  const script = join(dir, 'build-graph.mjs');
  const wrong = [];
  CASES.forEach(([name, input, code, needle], index) => {
    const file = join(dir, `case-${index}.json`);
    writeFileSync(file, typeof input === 'string' ? input : JSON.stringify(input));
    const r = spawnSync('node', [script, 'check', file], { encoding: 'utf8' });
    const seen = code === 0 ? r.stdout : r.stderr;
    if (r.status !== code || !seen.includes(needle)) wrong.push(`${name} (exit ${r.status})`);
  });
  const plan = join(dir, 'plan.json');
  writeFileSync(plan, JSON.stringify(graph([unit('A'), unit('B', { dependsOn: ['A'] }), unit('C'), unit('D', { dependsOn: ['B', 'C'] })])));
  const p = spawnSync('node', [script, 'plan', plan], { encoding: 'utf8' });
  if (p.status !== 0 || p.stdout !== 'wave 1: A, C\nwave 2: B\nwave 3: D\n') wrong.push(`plan waves (${p.status}: ${JSON.stringify(p.stdout)})`);
  const cyc = join(dir, 'cyc.json');
  writeFileSync(cyc, JSON.stringify(graph([unit('A', { dependsOn: ['B'] }), unit('B', { dependsOn: ['A'] })])));
  const pc = spawnSync('node', [script, 'plan', cyc], { encoding: 'utf8' });
  if (pc.status !== 1 || pc.stdout !== '' || !pc.stderr.includes('dependency cycle')) wrong.push(`plan refuses a bad graph (${pc.status})`);
  const gone = spawnSync('node', [script, 'check', join(dir, 'absent.json')], { encoding: 'utf8' });
  if (gone.status !== 1 || !gone.stderr.includes('cannot read')) wrong.push(`missing file (${gone.status})`);
  for (const args of [[], ['check'], ['plan', plan, 'extra'], ['build', plan]]) {
    const u = spawnSync('node', [script, ...args], { encoding: 'utf8' });
    if (u.status !== 2) wrong.push(`usage ${JSON.stringify(args)} (${u.status})`);
  }
  return wrong;
}

// Stage a copy of the script and its imports, optionally mutated; return the directory.
function stage(mutation) {
  const dir = mkdtempSync(join(tmpdir(), 'build-graph-eval-'));
  for (const name of ['cli-lib.mjs', 'derived-merge.mjs']) copyFileSync(join(SCRIPTS, name), join(dir, name));
  let source = readFileSync(join(SCRIPTS, 'build-graph.mjs'), 'utf8');
  if (mutation) {
    const [from, to] = mutation;
    expect(source.includes(from), `mutation target is gone: ${from}`);
    source = source.replace(from, to);
  }
  writeFileSync(join(dir, 'build-graph.mjs'), source);
  return dir;
}

const MUTANTS = [
  ['no cycle detection', ['if (cyclic.length)', 'if (false)']],
  ['no directory overlap', ['a === b || a === \'\' || b === \'\' || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)', 'a === b']],
  ['one-way ordering', ['ancestors.get(a.unit.id)?.has(b.unit.id) || ancestors.get(b.unit.id)?.has(a.unit.id)', 'ancestors.get(a.unit.id)?.has(b.unit.id)']],
  ['direct-only ordering', ['queue.push(...(direct.get(dep) ?? []))', 'void 0']],
  ['no case fold', ['.toLowerCase();', ';']],
  ['no backslash fold', ['path.replace(/\\\\/g, \'/\').replace(/\\/+/g', 'path.replace(/\\/+/g']],
  ['no leading dot-slash fold', ['.replace(/^(\\.\\/)+/, \'\')', '']],
  ['no trailing slash fold', ['.replace(/\\/$/, \'\')', '']],
  ['cross-repo conflict', ['a.unit.repo !== b.unit.repo', 'false']],
  ['generated check off', ['function isGenerated(path) {', 'function isGenerated(path) {\n  return false;']],
  ['no digests rule', ['digests(\\/|$)', 'digestz(\\/|$)']],
  ['no global contract rule', ['agents\\.(?!source', 'agentz\\.(?!source']],
  ['no manifest case fold', ['docs_manifest\\.json$/', 'docs_manifestz\\.json$/']],
  ['versions group counted generated', ['group.id !== \'versions\'', 'true']],
  ['glob allowed', ['/[*?[]/.test(segment)', 'false']],
  ['dot segment allowed', ['segment === \'.\'', 'false']],
  ['empty segment allowed', ['segment === \'\'', 'false']],
  ['no escape check', ['.includes(\'..\')', '.includes(\'\\0\')']],
  ['zero budget allowed', ['unit.roundBudget <= 0', 'unit.roundBudget < 0']],
  ['fractional budget allowed', ['!Number.isInteger(unit.roundBudget)', 'typeof unit.roundBudget !== \'number\'']],
  ['doneWhen unchecked', ['if (!isText(unit.doneWhen))', 'if (false)']],
  ['gate unchecked', ['if (!isText(unit.gate))', 'if (false)']],
  ['duplicate ids allowed', ['else if (byId.has(unit.id)) bad', 'else if (false) bad']],
  ['unknown dependency allowed', ['if (!byId.has(dep)) problems.push', 'if (false) problems.push']],
  ['unknown keys allowed', ['if (!UNIT_KEYS.includes(key))', 'if (false)']],
  ['version unchecked', ['if (graph.version !== 1)', 'if (false)']],
  ['problems exit 0', ['    return 1;\n  }\n  if (verb', '    return 0;\n  }\n  if (verb']],
  ['plan skips the check', ['const { graph, problems } = load(/** @type {string} */ (file));', 'const { graph, problems } = verb === \'plan\' ? { graph: load(/** @type {string} */ (file)).graph, problems: [] } : load(/** @type {string} */ (file));']],
  ['plan waves merged', ['waves.push(wave);', 'waves[0] = [...(waves[0] ?? []), ...wave];']],
];

const dirs = [];
try {
  const baseDir = stage(null);
  dirs.push(baseDir);
  const wrong = suite(baseDir);
  check('case suite passes on the real script', wrong.length === 0, wrong.join('; '));
  if (wrong.length === 0) {
    for (const [name, mutation] of MUTANTS) {
      const dir = stage(mutation);
      dirs.push(dir);
      check(`mutant killed: ${name}`, suite(dir).length > 0, 'the suite still passes with the rule weakened');
    }
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nbuild-graph eval: ${fails.length} failure(s)`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nbuild-graph eval: pass (${CASES.length + 8} cases, ${MUTANTS.length} mutants)`);
