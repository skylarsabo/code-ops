#!/usr/bin/env node
// Regression eval for scripts/context-query.mjs, scripts/symbol-lib.mjs, and the opt-in
// PostToolUse hook plugins/code-ops-suite/hooks/index-refresh.mjs.
//
//   node evals/context-query/run.mjs
//
// Builds a throwaway git repository from fixture/ in the OS temp dir, points the index store at
// a temp dir through CODE_OPS_INDEX_DIR, and pins the contract:
//   - refresh indexes every tracked code file and re-parses only what changed;
//   - find answers exact names, `path:name` pins, and --fuzzy substrings;
//   - callers resolves same-file first, then an imported name (an `as` alias included), and a
//     local shadow never claims a call meant for the import;
//   - callees lists a body's calls with their resolution and marks builtins unresolved;
//   - Python relative imports resolve;
//   - blast lists importers by depth and definitions with caller counts;
//   - explore ranks definitions, then lines, stops at --budget with BUDGET_EXCEEDED, and
//     --with-source appends bodies within the budget;
//   - a file edited after the index carries a stale banner until refreshed, and
//     --no-stale-check suppresses it;
//   - unknown symbols exit 1, bad flags exit 2, --json parses;
//   - the hook is off by default, re-indexes the edited file when on, and fails open.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const query = join(root, 'scripts', 'context-query.mjs');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'index-refresh.mjs');
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

const work = mkdtempSync(join(tmpdir(), 'context-query-'));
const store = mkdtempSync(join(tmpdir(), 'context-index-'));
const env = { ...process.env, CODE_OPS_INDEX_DIR: store };
delete env.CODE_OPS_INDEX;
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=q', '-c', 'user.email=q@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: work, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const q = (...args) => spawnSync('node', [query, ...args], { cwd: work, encoding: 'utf8', env });
const qj = (...args) => { const r = q(...args, '--json'); let j = null; try { j = JSON.parse(r.stdout); } catch { /* reported by caller */ } return { r, j }; };

try {
  git('init', '-q');
  cpSync(join(here, 'fixture'), work, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');

  // ---------------------------------------------------------------- refresh
  const first = qj('refresh');
  expect(first.r.status === 0 && first.j?.files === 7 && first.j.parsed === 7, `refresh must index the seven code files, got ${first.r.stdout}${first.r.stderr}`);
  const again = qj('refresh');
  expect(again.j?.parsed === 0 && again.j.reused === 7, `a second refresh must reuse every entry, got ${again.r.stdout}`);
  console.log('ok   refresh indexes seven files and reuses them unchanged');

  // ---------------------------------------------------------------- find
  const found = qj('find', 'slugify');
  expect(found.j?.definitions.length === 2 && found.j.definitions.every((d) => d.name === 'slugify'), `find slugify must return the two definitions, got ${found.r.stdout}`);
  const pinned = qj('find', 'src/text.js:slugify');
  expect(pinned.j?.definitions.length === 1 && pinned.j.definitions[0].file === 'src/text.js' && pinned.j.definitions[0].end === 3, `a path:name pin returns one definition with its span, got ${pinned.r.stdout}`);
  const fuzzy = qj('find', 'slug', '--fuzzy');
  expect(fuzzy.j?.definitions.length === 2, `--fuzzy slug finds both slugify definitions, got ${fuzzy.r.stdout}`);
  const missing = q('find', 'nothingHere');
  expect(missing.status === 1 && /no definition named nothingHere/.test(missing.stdout), `an unknown symbol exits 1, got ${missing.status}: ${missing.stdout}`);
  console.log('ok   find answers names, pins, fuzzy matches, and unknowns');

  // ---------------------------------------------------------------- callers and callees
  const callers = qj('callers', 'src/text.js:slugify');
  const sites = (callers.j?.callers ?? []).map((c) => `${c.file}:${c.from}:${c.how}`);
  expect(sites.includes('src/users.js:getUser:import') && sites.includes('src/text.js:helper:local'), `callers of text.js slugify are getUser (import) and helper (local), got ${sites.join(' ')}`);
  expect(!sites.some((s) => s.startsWith('src/other.js')), `the local shadow in other.js must not count as a caller, got ${sites.join(' ')}`);
  const alias = qj('callers', 'src/text.js:truncate');
  expect((alias.j?.callers ?? []).some((c) => c.file === 'src/users.js' && c.from === 'getUser' && c.how === 'import'), `a call through an as-alias resolves to the import, got ${alias.r.stdout}`);
  const shadow = qj('callers', 'src/other.js:slugify');
  expect(shadow.j?.callers.length === 1 && shadow.j.callers[0].from === 'run' && shadow.j.callers[0].how === 'local', `the shadow's only caller is run (local), got ${shadow.r.stdout}`);
  const callees = qj('callees', 'src/users.js:getUser');
  const outs = (callees.j?.callees ?? []).map((c) => `${c.name}:${c.how}`);
  expect(outs.includes('fetchUser:local') && outs.includes('slugify:import') && outs.includes('cut:import'), `getUser calls fetchUser (local), slugify and cut (import), got ${outs.join(' ')}`);
  const py = qj('callers', 'py/util.py:read_json');
  const pySites = (py.j?.callers ?? []).map((c) => `${c.file}:${c.from}:${c.how}`);
  expect(pySites.includes('py/app.py:load:import') && pySites.includes('py/util.py:summarize:local'), `Python relative imports resolve, got ${pySites.join(' ')}`);
  const text = q('callers', 'src/text.js:slugify');
  expect(/ceiling: line regexes/.test(text.stdout) && /src\/users\.js:10  in getUser  \[import\]/.test(text.stdout), `the text report carries anchors and the ceiling, got:\n${text.stdout}`);
  console.log('ok   callers and callees resolve local, imported, aliased, and Python edges');

  // ---------------------------------------------------------------- blast
  const blast = qj('blast', 'src/text.js');
  expect(blast.j?.importers.some((i) => i.file === 'src/users.js' && i.depth === 1) && !blast.j.importers.some((i) => i.file === 'src/other.js'), `blast lists users.js at depth 1 and not other.js, got ${blast.r.stdout}`);
  const counts = Object.fromEntries((blast.j?.definitions ?? []).map((d) => [d.name, d.callers]));
  expect(counts.slugify === 2 && counts.truncate === 1 && counts.helper === 0, `blast counts callers per definition, got ${JSON.stringify(counts)}`);
  const notCode = q('blast', 'README.md');
  expect(notCode.status === 1, `blast on a non-code path exits 1, got ${notCode.status}`);
  console.log('ok   blast lists importers by depth and caller counts');

  // ---------------------------------------------------------------- explore
  const wide = qj('explore', 'slug', '--budget', '4000');
  expect(wide.j && !wide.j.truncated && wide.j.results.some((l) => l.startsWith('src/text.js:1-3')) && wide.j.results.some((l) => /src\/users\.js:10 /.test(l)), `explore ranks the definition first and then matching lines, got ${wide.r.stdout}`);
  const tight = q('explore', 'slug', '--budget', '200');
  expect(/BUDGET_EXCEEDED at 200 bytes/.test(tight.stdout) && Buffer.byteLength(tight.stdout) < 500, `a tight budget stops with the marker, got ${tight.stdout}`);
  const withSource = qj('explore', 'paginate', '--with-source', '--budget', '4000');
  expect(withSource.j?.source.some((s) => s.startsWith('--- src/lib/page.js:3-6')) && /rows\.slice/.test(withSource.j?.source.join('\n') ?? ''), `--with-source appends the body within budget, got ${withSource.r.stdout}`);
  console.log('ok   explore ranks, budgets, and appends source on request');

  // ---------------------------------------------------------------- staleness
  writeFileSync(join(work, 'src', 'text.js'), readFileSync(join(work, 'src', 'text.js'), 'utf8') + '\nexport function extra() {\n  return 1;\n}\n');
  const stale = q('find', 'slugify');
  expect(/!! stale: src\/text\.js changed since the index/.test(stale.stdout), `an edited file carries the stale banner, got ${stale.stdout}`);
  const quiet = q('find', 'slugify', '--no-stale-check');
  expect(!/stale/.test(quiet.stdout), '--no-stale-check suppresses the banner');
  const status = qj('status');
  expect(status.j?.stale.length === 1 && status.j.stale[0].file === 'src/text.js', `status names the changed file, got ${status.r.stdout}`);
  const one = qj('refresh', 'src/text.js');
  expect(one.j?.parsed === 1, `refresh <path> re-parses only that file, got ${one.r.stdout}`);
  const fresh = q('find', 'extra');
  expect(fresh.status === 0 && !/stale/.test(fresh.stdout) && /src\/text\.js:13-15/.test(fresh.stdout), `after refresh the new definition is found with no banner, got ${fresh.stdout}`);
  console.log('ok   the stale banner appears after an edit and clears after refresh');

  // ---------------------------------------------------------------- usage
  const bad = q('find', 'x', '--depth', 'zero');
  expect(bad.status === 2, `a bad flag value exits 2, got ${bad.status}`);
  const none = q();
  expect(none.status === 2, `no command exits 2, got ${none.status}`);
  console.log('ok   usage errors exit 2');

  // ---------------------------------------------------------------- the hook
  const indexPath = join(store, 'index.json');
  const before = readFileSync(indexPath, 'utf8');
  writeFileSync(join(work, 'src', 'other.js'), readFileSync(join(work, 'src', 'other.js'), 'utf8') + '\nexport function added() {\n  return run();\n}\n');
  const payload = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: work, tool_input: { file_path: join(work, 'src', 'other.js') }, tool_response: {} });
  const off = spawnSync('node', [hook], { input: payload, encoding: 'utf8', cwd: work, env });
  expect(off.status === 0 && off.stdout === '' && readFileSync(indexPath, 'utf8') === before, 'off by default: the hook prints nothing and the index is unchanged');
  const on = spawnSync('node', [hook], { input: payload, encoding: 'utf8', cwd: work, env: { ...env, CODE_OPS_INDEX: 'on' } });
  expect(on.status === 0 && on.stdout === '', `with the switch on the hook prints nothing, got ${on.status}/${JSON.stringify(on.stdout)}`);
  const added = qj('find', 'src/other.js:added');
  expect(added.j?.definitions.length === 1 && !added.j.stale.length, `the hook re-indexed the edited file, got ${added.r.stdout}`);
  for (const [name, input] of [['bad JSON', '{'], ['another tool', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })], ['no path', JSON.stringify({ tool_name: 'Write', tool_input: {} })]]) {
    const r = spawnSync('node', [hook], { input, encoding: 'utf8', cwd: work, env: { ...env, CODE_OPS_INDEX: 'on' } });
    expect(r.status === 0 && r.stdout === '', `${name}: the hook fails open, got ${r.status}/${JSON.stringify(r.stdout)}`);
  }
  console.log('ok   the refresh hook is off by default, re-indexes on Edit when on, and fails open');
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\ncontext-query eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\ncontext-query eval passed');
