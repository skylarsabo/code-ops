#!/usr/bin/env node
// Regression eval for peer surface notes (PR 9 of "Agent state machine and host parity 2026-09"):
// the `## Peers` parser, peer discovery, and the surface notes in scripts/collision-lib.mjs, run in
// process and through plugins/code-ops-suite/hooks/dispatch-guard.mjs. It pins the contract:
//   - peers are discovered from the live board and the run folders, with no `## Peers` section
//     anywhere: three other programs are found, this session's own program and an idle peer are not,
//     and no surface note fires without a declaration;
//   - the parser reads `- <slug | *> · Surfaces: ... · Notify: edit|merge`, normalizes `process:`
//     surfaces, and ignores malformed lines and other sections;
//   - an edit to a surface either ledger declares for the other program (or `*`) with Notify edit
//     warns, names the peer's live session with a ready SendMessage line, and needs no recent peer
//     edit; Notify merge, an undeclared path, and a line aimed at another program stay silent;
//   - a `git merge` or `git push` whose diff touches a surface with Notify edit or merge warns, and
//     no git runs when no path surface is declared;
//   - a kill command (`taskkill`, `pkill`, `kill`, `Stop-Process`) that names a declared
//     `process:` surface warns, and one that names another process does not;
//   - a peer that handed off is named by its live head, one note covers both sessions, and a head
//     the board marks ended is silent;
//   - the note fires once per surface and peer per session, and the off switch silences it;
//   - mutation: with the surface branch or the process branch removed, a case fails.
//
//   node evals/peer-surfaces/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoIdentity } from '../../scripts/handoff-state.mjs';
import { collisionNote, discoverPeers, parsePeers } from '../../scripts/collision-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'dispatch-guard.mjs');
const { fails, check } = tally((name, detail) => `${name} — ${String(detail).slice(0, 300)}`);

const tmp = mkdtempSync(join(tmpdir(), 'peer-surfaces-'));
const home = join(tmp, 'home');
const repo = join(tmp, 'repo');
const remote = join(tmp, 'remote.git');
mkdirSync(home, { recursive: true });
mkdirSync(repo, { recursive: true });
process.env.CODE_OPS_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.CODE_OPS_PEER_GUARD = '';

const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
const must = (r, what) => { if (r.status !== 0) { console.error(`${what} failed: ${r.stderr}`); process.exit(1); } };
const put = (path, body) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), body); };

must(git('init', '-q', '-b', 'main'), 'git init');
for (const f of ['lib/core.js', 'src/api/x.js', 'README.md', 'shared/schema.sql', 'svc/delta/a.js', 'config/app.json', 'zulu/x.js']) put(f, 'x\n');
must(git('add', 'lib', 'src', 'README.md', 'shared', 'svc', 'config', 'zulu'), 'git add');
must(git('commit', '-q', '-m', 'base'), 'git commit');
must(spawnSync('git', ['init', '-q', '--bare', remote], { encoding: 'utf8' }), 'git init bare');
must(git('remote', 'add', 'origin', remote), 'git remote');
must(git('push', '-q', '-u', 'origin', 'main'), 'git push');
for (const [branch, file] of [['feature', 'lib/core.js'], ['other', 'README.md']]) {
  must(git('checkout', '-q', '-b', branch, 'main'), 'git checkout');
  put(file, `${branch}\n`);
  must(git('commit', '-q', '-am', branch), 'git commit');
}
must(git('checkout', '-q', 'main'), 'git checkout main');

const ident = repoIdentity(repo);
const boardDir = join(home, '.claude', 'code-ops', 'board', ident.key);
const sessionDir = join(home, '.claude', 'code-ops', 'sessions', ident.key);
mkdirSync(boardDir, { recursive: true });
mkdirSync(sessionDir, { recursive: true });
const MIN = 60_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const slug = (s) => s.replace(/[^A-Za-z0-9]/g, '-');
const board = (sid, fields = {}) => writeFileSync(join(boardDir, `${slug(sid)}.json`), JSON.stringify({
  v: 1, sessionId: sid, hostSessionId: `local_${sid}`, name: sid, branch: 'main', worktree: '.', claims: [], edits: [], heartbeat: ago(2 * MIN), ended: null, ...fields,
}));
const ledgerPath = (program) => join(repo, 'programs', program, 'PROGRAM.md');
const ledger = (program, body) => { put(`programs/${program}/PROGRAM.md`, `# PROGRAM: ${program}\n\n${body}`); };
// One session: its run folder, SESSION.json (naming its program), and session record.
function session(sid, program, extra = {}) {
  const run = `runs/${slug(sid).toLowerCase()}`;
  put(`${run}/SESSION.json`, JSON.stringify({ name: sid, sessionId: sid, hostSessionId: `local_${sid}`, program: ledgerPath(program), ...extra }));
  writeFileSync(join(sessionDir, `${slug(sid)}.json`), JSON.stringify({ v: 1, sessionId: sid, hostSessionId: `local_${sid}`, name: sid, worktree: '.', runDir: run, updatedAt: ago(MIN) }));
  return run;
}

for (const program of ['alpha', 'bravo', 'charlie', 'delta']) ledger(program, '## Decisions\n\n- nothing\n');
session('Me', 'alpha');
session('Alpha2', 'alpha');
session('Bravo', 'bravo');
session('Charlie', 'charlie');
session('Idle', 'charlie');
board('Alpha2');
board('Bravo');
board('Charlie');
board('Idle', { heartbeat: ago(45 * MIN) });
// Delta handed off: Delta-old's run names Delta-new as its successor.
const oldRun = session('Delta-old', 'delta');
put(`${oldRun}/HANDOFF.md`, '# HANDOFF\n');
put(`${oldRun}/HANDOFF.consumed`, JSON.stringify({ v: 2, consumedAt: ago(MIN), bySession: 'Delta-new', successorRun: 'runs/delta-new', name: 'Delta-new' }));
put('runs/delta-new/SESSION.json', JSON.stringify({ name: 'Delta-new', sessionId: 'Delta-new', hostSessionId: 'local_Delta-new', program: ledgerPath('delta') }));
board('Delta-old');

// Every session id a case uses is a session of program alpha, with its own session record.
const mine = new Set(['Me']);
const asAlpha = (sid) => { if (!mine.has(sid)) { mine.add(sid); session(sid, 'alpha'); } return sid; };
const edit = (sid, path, extra = {}) => ({ hook_event_name: 'PreToolUse', cwd: repo, session_id: asAlpha(sid), tool_name: 'Edit', tool_input: { file_path: join(repo, path) }, ...extra });
const bash = (sid, command) => ({ hook_event_name: 'PreToolUse', cwd: repo, session_id: asAlpha(sid), tool_name: 'Bash', tool_input: { command } });
const spawns = [];
const counting = (cmd, args, opts) => { spawns.push(args); return spawnSync(cmd, args, opts); };
// The delivered note: the call is in process and commits, as the hook does after it emits.
const note = (payload) => { spawns.length = 0; const n = collisionNote(payload, Date.now(), counting); n?.commit(); return n?.text ?? ''; };
const surface = (text) => text.split('\n').find((l) => l.startsWith('Surface note (warn only, nothing is blocked)')) ?? '';
function hookCall(payload, env = {}) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: '', CODE_OPS_DISPATCH_GUARD: '', CODE_OPS_ROUND_BUDGET: '', ...env },
  });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { out = 'unparsable'; }
  return { status: r.status, stdout: r.stdout, note: out?.hookSpecificOutput?.additionalContext ?? '', decision: out?.hookSpecificOutput?.permissionDecision };
}

try {
  // Parser.
  const parsed = parsePeers([
    '## Decisions', '- bravo · Surfaces: ignored.js · Notify: edit', '',
    '## Peers', '',
    '- bravo · Surfaces: src/api/**, ./config/app.json, `docs/spec.md` · Notify: edit',
    '- * · Surfaces: shared/, process:Node.exe, process: · Notify: MERGE',
    '- bravo · Surfaces: no-notify.js', '- bravo · Notify: edit', '- bravo · Surfaces: x.js · Notify: always',
    '- two words · Surfaces: x.js · Notify: edit', 'not a bullet · Surfaces: x.js · Notify: edit', '- bravo · Surfaces: , · Notify: edit',
    '## Later', '- bravo · Surfaces: late.js · Notify: edit',
  ].join('\n'));
  check('parser: reads each well-formed line, normalizes paths and process names, and keeps the `*` target',
    parsed.length === 2 && parsed[0].target === 'bravo' && parsed[0].notify === 'edit'
    && parsed[0].surfaces.join() === 'src/api/**,config/app.json,docs/spec.md'
    && parsed[1].target === '*' && parsed[1].notify === 'merge' && parsed[1].surfaces.join() === 'shared/,process:Node', JSON.stringify(parsed));
  check('parser: no `## Peers` section, an empty section, and non-text give no declarations',
    parsePeers('# PROGRAM: x\n\n## Decisions\n- a\n').length === 0 && parsePeers('## Peers\n').length === 0 && parsePeers(undefined).length === 0 && parsePeers(7).length === 0, '');

  // Discovery with no `## Peers` section anywhere.
  const found = discoverPeers(repo, 'Me');
  const names = found.map((p) => p.name).sort().join();
  check('discovery: three other programs are found with no `## Peers` section, named by program and live head',
    names === 'Bravo,Charlie,Delta-new' && found.find((p) => p.name === 'Bravo').program === 'bravo'
    && found.find((p) => p.name === 'Delta-new').program === 'delta', JSON.stringify(found.map((p) => [p.name, p.program])));
  check('discovery: this session\'s own program and an idle peer are not peers', !names.includes('Alpha2') && !names.includes('Idle'), names);
  check('discovery: a handed-off peer carries its head session ids and head run folder',
    found.find((p) => p.name === 'Delta-new').sessionId === 'Delta-new' && found.find((p) => p.name === 'Delta-new').runDir === resolve(repo, 'runs', 'delta-new'), JSON.stringify(found));
  check('discovery: a caller with no program sees every other program as a peer, and a missing store finds none',
    discoverPeers(repo, 'Me', Date.now(), null).length === 4 && discoverPeers(repo, 'unknown-session').length === 4 && discoverPeers(join(tmp, 'nowhere'), 'Me').length === 0, '');
  check('no `## Peers` section: edits, merges, and kills are silent and run no git',
    note(edit('p0', 'src/api/x.js')) === '' && note(bash('p0', 'git merge feature')).includes('Surface note') === false && spawns.length === 0 && note(bash('p0', 'taskkill /IM devserver.exe')) === '', '');

  // Declarations.
  ledger('alpha', '## Peers\n\n- bravo · Surfaces: src/api/**, config/app.json · Notify: edit\n');
  ledger('bravo', '## Peers\n\n- alpha · Surfaces: lib/core.js · Notify: merge\n- alpha · Surfaces: process:devserver · Notify: edit\n- alpha · Surfaces: bad.js\n');
  ledger('charlie', '## Peers\n\n- * · Surfaces: shared/schema.sql · Notify: edit\n- zulu · Surfaces: zulu/x.js · Notify: edit\n');
  ledger('delta', '## Peers\n\n- alpha · Surfaces: svc/delta/** · Notify: edit\n');

  let text = note(edit('p1', 'src/api/x.js'));
  check('surface edit: a path this ledger declares for bravo warns, names the live peer session and a ready SendMessage line, with no recent peer edit',
    surface(text).includes('surface src/api/** shared with program "bravo", live session "Bravo"') && surface(text).includes('SendMessage {"to":"Bravo","message":"I am about to edit src/api/x.js')
    && !surface(text).includes('"Charlie"'), text);
  check('surface edit: a path the peer ledger declares for this program warns too (declared by either side)',
    note(edit('p1b', 'svc/delta/a.js')).includes('program "delta"'), '');
  check('surface edit: Notify merge does not warn on an edit', note(edit('p2', 'lib/core.js')) === '', '');
  check('surface edit: an undeclared path and a line aimed at another program stay silent', note(edit('p2', 'README.md')) === '' && note(edit('p2', 'zulu/x.js')) === '', '');
  text = note(edit('p3', 'shared/schema.sql'));
  check('surface edit: a `*` surface applies to this program and names its peer', surface(text).includes('program "charlie", live session "Charlie"') && !surface(text).includes('"Bravo"'), text);
  check('surface edit: a glob stays inside its segments, and a declared path covers the directory below it',
    note(edit('p3', 'src/other/x.js')) === '' && note(edit('p3', 'config/app.json')).includes('config/app.json'), '');

  // Once per surface and peer per session.
  check('dedupe: the same surface and peer is silent the second time in one session', note(edit('p1', 'src/api/x.js')) === '' && note(edit('p1', 'src/api/y.js')) === '', '');
  check('dedupe: another session and a subagent each get their own first note',
    note(edit('p4', 'src/api/x.js')).includes('Surface note') && note(edit('p1', 'src/api/x.js', { agent_id: 'sub' })).includes('Surface note'), '');
  check('dedupe: a different surface from the same peer still warns', note(edit('p1', 'config/app.json')).includes('config/app.json'), '');

  // Merge and push diffs.
  text = note(bash('m1', 'git merge feature'));
  check('surface merge: a git merge whose diff touches a Notify merge surface warns and names the peer',
    surface(text).includes('program "bravo", live session "Bravo"') && surface(text).includes('which changes lib/core.js') && surface(text).includes('git merge'), text);
  check('surface merge: the diff is one git diff, not a status', spawns.some((a) => a.includes('diff') && a.includes('HEAD...feature')), JSON.stringify(spawns));
  check('surface merge: a merge whose diff touches no surface is silent', note(bash('m2', 'git merge other')).includes('Surface note') === false, '');
  check('surface merge: the same surface does not warn twice in one session', note(bash('m1', 'git merge feature')).includes('Surface note') === false, '');
  put('lib/core.js', 'main\n');
  must(git('commit', '-q', '-am', 'main change'), 'git commit');
  text = note(bash('m3', 'git push'));
  check('surface merge: a git push whose diff against the upstream touches a surface warns', surface(text).includes('which changes lib/core.js') && surface(text).includes('git push'), text);
  const saved = ['alpha', 'bravo', 'charlie', 'delta'].map((program) => [program, readFileSync(ledgerPath(program), 'utf8')]);
  for (const [program] of saved) ledger(program, program === 'bravo' ? '## Peers\n\n- alpha · Surfaces: process:devserver · Notify: edit\n' : '## Decisions\n');
  check('surface merge: with no path surface declared for a merge or push no git diff runs', (note(bash('m4', 'git push')), !spawns.some((a) => a.includes('diff'))), JSON.stringify(spawns));
  for (const [program, body] of saved) put(`programs/${program}/PROGRAM.md`, body);

  // Process kills, through the hook so the forwarding hint is exercised.
  let r = hookCall(bash('k1', 'taskkill /F /IM devserver.exe'));
  check('process kill: taskkill naming a declared process surface warns through the hook and names the peer',
    r.status === 0 && r.decision === undefined && r.note.includes('Surface note (warn only') && r.note.includes('program "bravo", live session "Bravo"')
    && r.note.includes('stops devserver') && r.note.includes('"to":"Bravo"'), r.stdout);
  for (const [i, command] of ['pkill -f devserver', 'kill $(pgrep devserver)', 'Get-Process devserver | Stop-Process', 'sudo kill -9 `pidof devserver`'].entries()) {
    check(`process kill: ${command.split(' ')[0] === 'sudo' ? 'sudo kill' : command.split(' ')[0] === 'Get-Process' ? 'Stop-Process' : command.split(' ')[0]} warns`, note(bash(`k${i + 2}`, command)).includes('stops devserver'), command);
  }
  check('process kill: another process, no kill command, and a name inside another word are silent',
    note(bash('k9', 'taskkill /IM chrome.exe')) === '' && note(bash('k9', 'node devserver.js')) === '' && note(bash('k9', 'echo devserver')) === '' && note(bash('k9', 'pkill -f devserver-extra')) === '', '');
  check('process kill: the same process does not warn twice in one session', hookCall(bash('k1', 'taskkill /IM devserver.exe')).note === '', '');

  // A handed-off peer.
  text = note(edit('h1', 'svc/delta/a.js'));
  check('handed-off peer: the note names the live head, never the predecessor',
    surface(text).includes('live session "Delta-new"') && surface(text).includes('"to":"Delta-new"') && !text.includes('Delta-old'), text);
  const head = found.find((p) => p.name === 'Delta-new');
  session('Delta-new', 'delta');
  board('Delta-new');
  check('handed-off peer: predecessor and successor both live is one peer and one note',
    discoverPeers(repo, 'Me').filter((p) => p.program === 'delta').length === 1 && (note(edit('h2', 'svc/delta/a.js')).match(/live session "/g) ?? []).length === 1 && head !== undefined, '');
  board('Delta-new', { ended: ago(MIN) });
  check('handed-off peer: a head the board marks ended is not messaged', note(edit('h3', 'svc/delta/a.js')) === '', '');
  board('Delta-new');
  board('Delta-old', { ended: ago(MIN) });
  board('Bravo', { heartbeat: ago(45 * MIN) });
  check('an idle peer and an ended predecessor with a live head: only the live head is named',
    note(edit('h4', 'src/api/x.js')) === '' && note(edit('h4', 'svc/delta/a.js')).includes('"Delta-new"'), '');
  board('Bravo');

  // Off switch and fail-open.
  r = hookCall(edit('o1', 'src/api/x.js'));
  check('hook: an edit to a declared surface warns and never denies', r.status === 0 && r.decision === undefined && r.note.includes('Surface note (warn only'), r.stdout);
  for (const off of ['off', '0', 'FALSE']) {
    check(`CODE_OPS_PEER_GUARD=${off} silences surface notes`, hookCall(edit('o2', 'src/api/x.js'), { CODE_OPS_PEER_GUARD: off }).stdout === ''
      && hookCall(bash('o2', 'taskkill /IM devserver.exe'), { CODE_OPS_PEER_GUARD: off }).stdout === '', '');
  }
  writeFileSync(ledgerPath('bravo'), '\u0000\u0001 garbage');
  put('programs/charlie/PROGRAM.md', `## Peers\n\n${'- * · Surfaces: big.js · Notify: edit\n'.repeat(60000)}`);
  check('a garbage ledger and an oversized ledger give no note and no crash', note(edit('f1', 'src/api/x.js')).includes('program "bravo"') === true && note(edit('f1', 'big.js')) === '', '');
  writeFileSync(join(sessionDir, 'broken.json'), '{nope');
  check('a corrupt session record is skipped', discoverPeers(repo, 'Me').length >= 1, '');

  // Mutation: removing a branch makes its case fail. The mutant reads the real handoff-state.
  const mutate = async (from, to, label, probe) => {
    const source = readFileSync(join(root, 'scripts', 'collision-lib.mjs'), 'utf8');
    if (!source.includes(from)) { check(`mutation (${label}): the mutation target still exists`, false, from); return; }
    const file = join(tmp, `mutant-${label}.mjs`);
    writeFileSync(file, source.replace(from, to).replace("'./handoff-state.mjs'", `'${pathToFileURL(join(root, 'scripts', 'handoff-state.mjs')).href}'`));
    const mutant = await import(pathToFileURL(file).href);
    process.env.CODE_OPS_HOME = home;
    ledger('bravo', '## Peers\n\n- alpha · Surfaces: process:devserver · Notify: edit\n');
    ledger('alpha', '## Peers\n\n- bravo · Surfaces: src/api/** · Notify: edit\n');
    board('Bravo');
    const real = probe(collisionNote);
    const broken = probe(mutant.collisionNote);
    check(`mutation (${label}): the real library passes the case and the mutant fails it`, real === true && broken === false, `${real} / ${broken}`);
  };
  let n = 0;
  const warnsFor = (payload) => (lib) => Boolean(lib({ ...payload, session_id: asAlpha(`mut${n++}`) }, Date.now(), counting)?.text.includes('Surface note'));
  await mutate('.filter((p) => surfaceMatches(surface, p))', '.filter(() => false)', 'surface branch', warnsFor(edit('x', 'src/api/x.js')));
  await mutate('namesProcess(subject, surface.slice(8))', 'false', 'process branch', warnsFor(bash('x', 'pkill devserver')));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) { console.error(`\n${fails.length} failure(s):\n${fails.map((f) => `  - ${f}`).join('\n')}`); process.exit(1); }
console.log('\npeer-surfaces: all cases passed');
