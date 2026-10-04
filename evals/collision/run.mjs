#!/usr/bin/env node
// Regression eval for the collision note (design C2): scripts/collision-lib.mjs, run through
// plugins/code-ops-suite/hooks/dispatch-guard.mjs, the one PreToolUse registration it lives in.
// It pins the contract:
//   - an edit tool call on a path a LIVE peer claimed, or edited within 6 hours, adds context that
//     names the peer, its branch, and a ready SendMessage line, and never denies
//     (collision-warns-never-denies);
//   - the note fires once per path per peer per session: a repeat is silent, a new path from the
//     same peer is not, another session and a subagent each get their own once;
//   - an idle peer (heartbeat older than 30 minutes), an ended peer, an edit older than 6 hours,
//     and this session's own record are ignored;
//   - `git pull`, `merge`, `rebase`, and `push` list the live peers on this branch and their
//     recent edits that overlap the uncommitted files; `merge-base`, `echo git push`, another
//     branch, and a plain shell command stay silent;
//   - the git note spawns at most one `git status`, limited to the peers' edited paths, and none
//     when no live peer on the branch has a recent edit or when no peer is on the branch;
//   - a corrupt board, a corrupt seen-set, a missing store, a missing library, a missing session
//     id, and the off switches all fail open with no output;
//   - the note never changes a dispatch-guard decision: a hard-stop deny is byte-identical with the
//     note present and leaves the once-only mark unspent, and an advisory carries the note in its
//     one output.
//
//   node evals/collision/run.mjs

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { repoIdentity } from '../../scripts/handoff-state.mjs';
import { collisionNote, gitVerb } from '../../scripts/collision-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'dispatch-guard.mjs');
const { fails, check } = tally((name, detail) => `${name} — ${String(detail).slice(0, 300)}`);

const tmp = mkdtempSync(join(tmpdir(), 'collision-'));
const home = join(tmp, 'home');
const repo = join(tmp, 'repo');
mkdirSync(join(repo, 'src'), { recursive: true });
mkdirSync(home, { recursive: true });
const init = spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
if (init.status !== 0) { console.error(`git init failed: ${init.stderr}`); process.exit(1); }
writeFileSync(join(repo, 'src', 'dirty.js'), 'x\n');
writeFileSync(join(repo, 'src', 'clean.js'), 'x\n');

const ident = repoIdentity(repo);
const boardDir = join(home, '.claude', 'code-ops', 'board', ident.key);
mkdirSync(boardDir, { recursive: true });
const MIN = 60_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const slug = (s) => s.replace(/[^A-Za-z0-9]/g, '-');
function peer(sid, fields = {}) {
  const rec = { v: 1, sessionId: sid, hostSessionId: `local_${sid}`, name: sid, branch: 'main', worktree: '.', claims: [], edits: [], heartbeat: ago(2 * MIN), ended: null, ...fields };
  writeFileSync(join(boardDir, `${slug(sid)}.json`), JSON.stringify(rec));
}

peer('Alpha', { claims: ['src/claimed.js'] });
peer('Beta', { branch: 'feat/beta', worktree: '../wt-beta', edits: [{ path: 'src/recent.js', at: ago(10 * MIN) }] });
peer('Gamma', { heartbeat: ago(45 * MIN), claims: ['src/idle.js'], edits: [{ path: 'src/idle.js', at: ago(50 * MIN) }] });
peer('Delta', { ended: ago(MIN), claims: ['src/ended.js'] });
peer('Epsilon', { branch: 'old', edits: [{ path: 'src/old.js', at: ago(7 * 60 * MIN) }] });
peer('Zeta', { branch: 'main', edits: [{ path: 'src/dirty.js', at: ago(5 * MIN) }, { path: 'src/other.js', at: ago(6 * MIN) }] });
peer('Theta', { branch: 'third', claims: ['src/third.js'] });
peer('Eta', { branch: 'topic', edits: [{ path: 'src/dirty.js', at: ago(5 * MIN) }] });

function call(payload, env = {}, hookPath = hook) {
  const child = { ...process.env, HOME: home, USERPROFILE: home, CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: '', CODE_OPS_DISPATCH_GUARD: '', CODE_OPS_ROUND_BUDGET: '', ...env };
  if (!Object.hasOwn(env, 'GROK_PLUGIN_ROOT')) delete child.GROK_PLUGIN_ROOT;
  const r = spawnSync(process.execPath, [hookPath], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: child,
  });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { out = 'unparsable'; }
  const spec = out?.hookSpecificOutput;
  return { status: r.status, stdout: r.stdout, out, note: spec?.additionalContext ?? '', decision: spec?.permissionDecision, reason: spec?.permissionDecisionReason ?? '' };
}
const edit = (sid, path, extra = {}, tool = 'Edit') => ({ hook_event_name: 'PreToolUse', cwd: repo, session_id: sid, tool_name: tool, tool_input: { file_path: join(repo, path) }, ...extra });
const bash = (sid, command) => ({ hook_event_name: 'PreToolUse', cwd: repo, session_id: sid, tool_name: 'Bash', tool_input: { command } });
const silent = (r) => r.status === 0 && r.stdout === '';
const warns = (r) => r.status === 0 && r.decision === undefined && r.note.startsWith('Collision note (warn only');

try {
  // Edit-tool collisions.
  let r = call(edit('s1', 'src/claimed.js'));
  check('collision-warns-never-denies: a claimed path warns, names the peer, branch, and a ready SendMessage line',
    warns(r) && r.note.includes('"Alpha"') && r.note.includes('branch main') && r.note.includes('src/claimed.js (claimed)')
    && r.note.includes('SendMessage {"to":"Alpha","message":'), r.stdout);
  check('the warning carries no permission decision', r.decision === undefined && r.reason === '' && r.out.hookSpecificOutput.hookEventName === 'PreToolUse', r.stdout);
  const grokNote = call(edit('s-grok', 'src/claimed.js'), { GROK_PLUGIN_ROOT: '/x' });
  check('grok collision names a dashboard reply', warns(grokNote) && grokNote.note.includes('Dashboard reply to Alpha:') && !grokNote.note.includes('SendMessage'), grokNote.stdout);

  r = call(edit('s2', 'src/recent.js', {}, 'Write'));
  check('a path a live peer edited 10 minutes ago warns with the age, branch, and worktree of that peer',
    warns(r) && r.note.includes('edited 10 min ago') && r.note.includes('branch feat/beta') && r.note.includes('worktree ../wt-beta') && r.note.includes('"to":"Beta"'), r.stdout);

  // Dedupe.
  check('dedupe: the same path, peer, and session is silent the second time', silent(call(edit('s1', 'src/claimed.js'))), '');
  check('dedupe: another edit tool on the same path is still silent', silent(call(edit('s1', 'src/claimed.js', {}, 'MultiEdit'))), '');
  r = call(edit('s1', 'src/recent.js'));
  check('dedupe: a new path from the same session still warns', warns(r) && r.note.includes('src/recent.js'), r.stdout);
  check('dedupe: a different session gets its own first warning', warns(call(edit('s3', 'src/claimed.js'))), '');
  r = call(edit('s1', 'src/claimed.js', { agent_id: 'agent-x' }));
  check('dedupe: a subagent of the same session keeps its own seen-set', warns(r), r.stdout);
  check('dedupe: that subagent is also warned once', silent(call(edit('s1', 'src/claimed.js', { agent_id: 'agent-x' }))), '');

  // Ignored peers and paths.
  check('an idle peer (heartbeat older than 30 minutes) is ignored', silent(call(edit('s4', 'src/idle.js'))), '');
  check('an ended peer is ignored', silent(call(edit('s4', 'src/ended.js'))), '');
  check('an edit older than 6 hours is ignored', silent(call(edit('s4', 'src/old.js'))), '');
  check('a path nobody touched is silent', silent(call(edit('s4', 'src/clean.js'))), '');
  check('a path outside the worktree is silent', silent(call({ ...edit('s4', 'x'), tool_input: { file_path: join(tmp, 'elsewhere', 'claimed.js') } })), '');
  check('this session\'s own record is not a peer', silent(call(edit('Alpha', 'src/claimed.js'))), '');
  check('a host session id also identifies this session', silent(call(edit('local_Alpha', 'src/claimed.js'))), '');
  check('a call with no session id is silent', silent(call({ ...edit('s5', 'src/claimed.js'), session_id: undefined })), '');

  // Other hosts' payload shapes.
  r = call({ hookEventName: 'PreToolUse', cwd: repo, sessionId: 's6', toolName: 'write', toolInput: { path: join(repo, 'src', 'claimed.js') } });
  check('Grok camelCase payloads map onto the same check', warns(r) && r.note.includes('"Alpha"'), r.stdout);
  r = call({ hook_event_name: 'PreToolUse', cwd: repo, session_id: 's7', tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** Update File: src/recent.js\n@@\n*** End Patch\n' } });
  check('an apply_patch payload names its file', warns(r) && r.note.includes('src/recent.js'), r.stdout);
  check('a non-edit, non-shell tool is silent', silent(call({ ...edit('s8', 'src/claimed.js'), tool_name: 'Read' })), '');

  // Git commands.
  r = call(bash('g1', 'git push origin main'));
  check('git push lists the live peers on this branch and the overlap with uncommitted files',
    warns(r) && r.note.includes('"Alpha"') && r.note.includes('"Zeta"') && r.note.includes('src/dirty.js') && r.note.includes('overlap your uncommitted files: src/dirty.js')
    && !r.note.includes('src/other.js') && r.note.includes('none of its recent edits overlap'), r.stdout);
  check('a peer on another branch is not listed', !r.note.includes('"Eta"') && !r.note.includes('"Beta"'), r.stdout);
  check('idle, ended, and old-edit peers are not listed for git either', !r.note.includes('"Gamma"') && !r.note.includes('"Delta"'), r.stdout);
  for (const verb of ['pull', 'merge origin/x', 'rebase main']) {
    check(`git ${verb.split(' ')[0]} warns`, warns(call(bash('g2', `git ${verb}`))), verb);
  }
  check('git -C <dir> and a && chain still match', warns(call(bash('g3', 'git -C . pull'))) && warns(call(bash('g3', 'cd . && git rebase main'))), '');
  check('git merge-base, git status, and echo git push are silent',
    silent(call(bash('g4', 'git merge-base main HEAD'))) && silent(call(bash('g4', 'git status'))) && silent(call(bash('g4', 'echo git push'))), '');
  check('a plain shell command is silent', silent(call(bash('g4', 'ls -la'))), '');
  check('gitVerb reads only the first word of each segment', gitVerb('FOO=1 git push') === 'push' && gitVerb('git commit -m "x" ; git pull') === 'pull'
    && gitVerb('git commit -m "a; git push"') === null && gitVerb('') === null && gitVerb(undefined) === null, '');
  peer('Zeta', { branch: 'elsewhere' });
  peer('Alpha', { branch: 'elsewhere' });
  check('git with no live peer on this branch is silent', silent(call(bash('g5', 'git push'))), '');
  peer('Alpha', { claims: ['src/claimed.js'] });
  peer('Zeta', { branch: 'main', edits: [{ path: 'src/dirty.js', at: ago(5 * MIN) }, { path: 'src/other.js', at: ago(6 * MIN) }] });

  // Spawn cost of the git note, counted in process: no git without a peer that has a recent edit,
  // one status limited to the peers' edited paths otherwise.
  process.env.CODE_OPS_HOME = home;
  const spawns = [];
  const counting = (cmd, args, opts) => { spawns.push(args); return spawnSync(cmd, args, opts); };
  const gitNote = (sid, command) => { spawns.length = 0; return collisionNote(bash(sid, command), Date.now(), counting); };
  let note = gitNote('n1', 'git push origin main');
  const limited = spawns[0]?.slice(spawns[0].indexOf('--') + 1).sort().join() ?? '';
  check('git note: with a peer that has recent edits, one status runs, limited to the listed peers\' edited paths as literal pathspecs',
    spawns.length === 1 && spawns[0].includes('--literal-pathspecs') && spawns[0].includes('status') && limited === 'src/dirty.js,src/other.js'
    && note?.text.includes('overlap your uncommitted files: src/dirty.js'), JSON.stringify(spawns));
  peer('Zeta', { branch: 'main' });
  note = gitNote('n2', 'git pull');
  check('git note: live peers on the branch with no recent edit run no git, and the note still lists them',
    spawns.length === 0 && note?.text.includes('with 2 other live sessions') && note.text.includes('none of its recent edits overlap'), JSON.stringify(spawns));
  peer('Zeta', { branch: 'elsewhere' });
  peer('Alpha', { branch: 'elsewhere' });
  note = gitNote('n3', 'git push');
  check('git note: no live peer on this branch runs no git and gives no note', spawns.length === 0 && note === null, JSON.stringify(spawns));
  peer('Alpha', { claims: ['src/claimed.js'] });
  peer('Zeta', { branch: 'main', edits: [{ path: 'src/dirty.js', at: ago(5 * MIN) }, { path: 'src/other.js', at: ago(6 * MIN) }] });
  spawns.length = 0;
  collisionNote(edit('n4', 'src/claimed.js'), Date.now(), counting);
  check('an edit-tool note spawns no git', spawns.length === 0, JSON.stringify(spawns));

  // Fail-open cases.
  writeFileSync(join(boardDir, 'garbage.json'), '{not json');
  writeFileSync(join(boardDir, 'array.json'), '[1,2]');
  writeFileSync(join(boardDir, 'nulls.json'), JSON.stringify({ sessionId: 'Bad', heartbeat: 5, claims: 'x', edits: [null, 7, { path: 3 }] }));
  r = call(edit('c1', 'src/claimed.js'));
  check('a corrupt board record is skipped and the good record still warns', warns(r) && r.note.includes('"Alpha"'), r.stdout);
  const seenDir = join(home, '.claude', 'code-ops', 'collision', ident.key);
  for (const f of readdirSync(seenDir)) writeFileSync(join(seenDir, f), 'garbage');
  check('a corrupt seen-set reads as empty', warns(call(edit('c1', 'src/claimed.js'))), '');
  check('a missing board store is silent', silent(call(edit('c2', 'src/claimed.js'), { CODE_OPS_HOME: join(tmp, 'nowhere') })), '');
  const emptyRepo = join(tmp, 'plain');
  mkdirSync(emptyRepo);
  check('a directory outside any repository is silent', silent(call({ ...edit('c3', 'x'), cwd: emptyRepo, tool_input: { file_path: join(emptyRepo, 'a.js') } })), '');
  check('malformed stdin is silent', silent(call('{nope')), '');
  const bare = join(tmp, 'plugin');
  mkdirSync(join(bare, 'hooks'), { recursive: true });
  copyFileSync(hook, join(bare, 'hooks', 'dispatch-guard.mjs'));
  copyFileSync(join(dirname(hook), 'agent-file.mjs'), join(bare, 'hooks', 'agent-file.mjs'));
  check('a missing collision-lib.mjs fails open with no output', silent(call(edit('c4', 'src/claimed.js'), {}, join(bare, 'hooks', 'dispatch-guard.mjs'))), '');

  // Off switches.
  for (const off of ['off', '0', 'FALSE']) {
    check(`CODE_OPS_PEER_GUARD=${off} silences the note`, silent(call(edit('o1', 'src/claimed.js'), { CODE_OPS_PEER_GUARD: off })), '');
  }
  check('CODE_OPS_DISPATCH_GUARD=off silences the note', silent(call(edit('o2', 'src/claimed.js'), { CODE_OPS_DISPATCH_GUARD: 'off' })), '');
  check('warn mode still warns and never denies', warns(call(edit('o3', 'src/claimed.js'), { CODE_OPS_DISPATCH_GUARD: 'warn' })), '');

  // The note never changes a dispatch-guard decision. Budget 2 puts the warning on call 2 and the
  // hard stop on call 3 (1.5 times the budget, and at least one past it).
  const budget = { CODE_OPS_ROUND_BUDGET: '2' };
  const sub = (agent, sid, path) => edit(sid, path, { agent_id: agent });
  const a1 = call(sub('ag-on', 'r1', 'src/claimed.js'), budget);
  check('a subagent call under budget carries the note alone', warns(a1) && a1.out.hookSpecificOutput.additionalContext.startsWith('Collision note'), a1.stdout);
  const a2 = call(sub('ag-on', 'r1', 'src/recent.js'), budget);
  check('at the budget the guard advisory keeps its text and the note joins the same output',
    a2.decision === undefined && a2.note.includes('Dispatch guard: 2 tool rounds used against a 2-round budget')
    && a2.note.includes('Collision note (warn only') && a2.note.includes('src/recent.js') && a2.stdout.trim().split('\n').length === 1, a2.stdout);
  const a3 = call(sub('ag-on', 'r1', 'src/third.js'), budget);
  call(sub('ag-off', 'r1', 'src/claimed.js'), { ...budget, CODE_OPS_PEER_GUARD: 'off' });
  call(sub('ag-off', 'r1', 'src/recent.js'), { ...budget, CODE_OPS_PEER_GUARD: 'off' });
  const off3 = call(sub('ag-off', 'r1', 'src/third.js'), { ...budget, CODE_OPS_PEER_GUARD: 'off' });
  check('the hard stop still denies with the note present, byte-identical to a run with the note off',
    a3.decision === 'deny' && a3.reason.includes('hard stop') && a3.stdout === off3.stdout && !a3.stdout.includes('Collision note'), `${a3.stdout} | ${off3.stdout}`);
  // A denied call spends no once-only mark: the same path warns when the guard no longer denies.
  const spare = call(sub('ag-two', 'r2', 'src/claimed.js'), budget);
  call(sub('ag-two', 'r2', 'src/claimed.js'), budget);
  const denied = call(sub('ag-two', 'r2', 'src/recent.js'), budget);
  const after = call(sub('ag-two', 'r2', 'src/recent.js'), { ...budget, CODE_OPS_DISPATCH_GUARD: 'warn' });
  check('a note dropped beside a denial is unspent and delivered on the next call that is not denied',
    warns(spare) && denied.decision === 'deny' && warns(after) && after.note.includes('src/recent.js'), `${denied.stdout} | ${after.stdout}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (!existsSync(join(root, 'plugins', 'code-ops-suite', 'scripts', 'collision-lib.mjs'))) fails.push('the vendored collision-lib.mjs is missing');
if (fails.length) { console.error(`\n${fails.length} failure(s):\n${fails.map((f) => `  - ${f}`).join('\n')}`); process.exit(1); }
console.log('\ncollision: all cases passed');
