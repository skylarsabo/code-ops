#!/usr/bin/env node
// Regression eval for scripts/workspace-layout.mjs and its two callers: the advisory-only
// "Workspace note" in plugins/code-ops-suite/hooks/dispatch-guard.mjs (behaviour 11) and the
// SessionStart folder setup in hooks/routing-card.mjs. It pins the contract:
//   - each host maps to its folder, and Codex avoids the read-only `.codex`;
//   - a worktree resolves its scratch folder to itself and its worktrees folder to the main checkout,
//     so worktrees never nest;
//   - ensure is idempotent, never overwrites an ignore file, never writes one into the host folder,
//     and git ignores both folders;
//   - a write inside the repository, the temp directory, a host home, or CODE_OPS_HOME, a Read, an
//     unknown tool, a non-git directory, and a command the parse cannot read with certainty are
//     silent; a write elsewhere and a `git worktree add` outside the worktrees folder earn one line;
//   - each distinct line is said once per session, the off switch silences it, a malformed payload
//     and a missing library fail open, and no output ever carries `permissionDecision` (outside an
//     existing denial) or `updatedInput`;
//   - the note does not change an existing denial or the lead streak, and a denial leaves its
//     once-only mark unspent;
//   - the SessionStart card names the folders on a live payload only, and `check` labels worktrees.
//
//   node evals/workspace-layout/run.mjs

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOST_FOLDERS, adviseCommand, adviseWrite, detectHost, ensureLayout, resolveLayout } from '../../scripts/workspace-layout.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const suite = join(root, 'plugins', 'code-ops-suite');
const guard = join(suite, 'hooks', 'dispatch-guard.mjs');
const card = join(suite, 'hooks', 'routing-card.mjs');
const cli = join(root, 'scripts', 'workspace-layout.mjs');
const { fails, check } = tally((name, detail) => `${name} — ${String(detail).slice(0, 300)}`);

// Every path the hooks see lives under `base`. The host temp directory is its own child, so a write
// to `elsewhere` is outside every allowed root and cannot pass because the fake repos sit in a
// temp directory.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'ws-layout-')));
const home = join(base, 'home');
const hosttmp = join(base, 'hosttmp');
const elsewhere = join(base, 'elsewhere');
const codexHome = join(base, 'codexhome');
const opsHome = join(base, 'opshome');
const receipts = join(base, 'receipts', 'session-receipts.jsonl');
for (const dir of [home, hosttmp, elsewhere, codexHome, opsHome]) mkdirSync(dir, { recursive: true });

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=e@example.invalid', '-c', 'user.name=eval', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
function makeRepo(name) {
  const dir = join(base, 'repos', name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}
const same = (a, b) => realpathSync.native(a) === realpathSync.native(b);
const fwd = (path) => path.replace(/\\/g, '/');

function envFor(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:CLAUDE|CODEX_|OPENCODE|GROK_|COPILOT_|CODE_OPS_)/.test(key)) delete env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, TEMP: hosttmp, TMP: hosttmp, TMPDIR: hosttmp, CODE_OPS_RECEIPTS: receipts, CODE_OPS_LEAD_STREAK: '100000', CLAUDE_PROJECT_DIR: base });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}
const run = (file, input, extra, cwd = base) => spawnSync(process.execPath, [file, ...(Array.isArray(input) ? input : [])], {
  input: Array.isArray(input) ? undefined : typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: envFor(extra), cwd, timeout: 30000,
});
const hook = (payload, extra, file = guard) => run(file, payload, extra);
const out = (r) => { try { return JSON.parse(r.stdout)?.hookSpecificOutput ?? null; } catch { return null; } };
const silent = (r) => r.status === 0 && r.stdout === '';
const note = (r) => { const o = out(r); return r.status === 0 && o && o.permissionDecision === undefined && o.updatedInput === undefined && /Workspace note:/.test(o.additionalContext ?? '') ? o.additionalContext : null; };
const advisories = [];
const speaks = (r) => { const text = note(r); if (text) advisories.push(r.stdout); return text; };

let n = 0;
const call = (cwd, tool, input, session, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: session ?? `ws-${++n}`, cwd, ...extra });
const write = (cwd, file, session, tool = 'Write') => call(cwd, tool, { file_path: file }, session);
const shell = (cwd, command, session, tool = 'Bash') => call(cwd, tool, { command }, session);

// ---- layout ----------------------------------------------------------------------------------
const main = makeRepo('main');
const expectedFolders = { claude: '.claude', codex: '.codex-work', grok: '.grok', opencode: '.opencode', copilot: '.copilot', other: '.agent-work' };
check('HOST_FOLDERS maps each host to its folder, and Codex avoids .codex',
  JSON.stringify(HOST_FOLDERS) === JSON.stringify(expectedFolders) && HOST_FOLDERS.codex !== '.codex', JSON.stringify(HOST_FOLDERS));
for (const [host, folder] of Object.entries(expectedFolders)) {
  const layout = resolveLayout(main, host);
  check(`resolveLayout puts ${host} under ${folder}`, layout?.host === host && layout.folder === folder
    && fwd(layout.tmp) === fwd(join(main, folder, '.tmp')) && fwd(layout.worktrees) === fwd(join(main, folder, 'worktrees')), JSON.stringify(layout));
}
check('an unknown host falls back to other', resolveLayout(main, 'nonsense')?.folder === '.agent-work', '');
const hostCases = [
  [{ GROK_PLUGIN_ROOT: 'x', CODEX_HOME: 'x', CLAUDE_X: '1' }, 'grok'], [{ CODEX_THREAD_ID: 'x', CLAUDE_X: '1' }, 'codex'], [{ CODEX_HOME: 'x', CLAUDE_X: '1' }, 'claude'], [{ CODEX_HOME: 'x' }, 'other'], [{ CLAUDE_X: '1', OPENCODE_X: '1' }, 'claude'],
  [{ OPENCODE_X: '1', COPILOT_HOME: 'x' }, 'opencode'], [{ COPILOT_HOME: 'x' }, 'copilot'], [{ PATH: 'x' }, 'other'],
];
check('detectHost follows the agent-ledger order, then Copilot', hostCases.every(([env, host]) => detectHost(env) === host), JSON.stringify(hostCases.map(([env]) => detectHost(env))));

const layout = resolveLayout(main, 'claude');
const before = ensureLayout(layout);
const tmpIgnore = join(layout.tmp, '.gitignore');
const treeIgnore = join(layout.worktrees, '.gitignore');
check('ensureLayout creates both folders, each with a * ignore file, and none in the host folder',
  before.length === 2 && readFileSync(tmpIgnore, 'utf8') === '*\n' && readFileSync(treeIgnore, 'utf8') === '*\n'
  && !existsSync(join(main, '.claude', '.gitignore')), before.join(','));
writeFileSync(tmpIgnore, 'custom\n');
check('ensureLayout never overwrites an ignore file, and a file with no * line does not count as ready',
  ensureLayout(layout).length === 1 && readFileSync(tmpIgnore, 'utf8') === 'custom\n', '');
writeFileSync(tmpIgnore, '*\n');
check('ensureLayout is idempotent', ensureLayout(layout).length === 2 && readFileSync(tmpIgnore, 'utf8') === '*\n', '');
check('ensureLayout never throws on null or an unwritable path', ensureLayout(null).length === 0 && ensureLayout({ tmp: join(tmpIgnore, 'x'), worktrees: join(treeIgnore, 'y') }).length === 0, '');
writeFileSync(join(layout.tmp, 'scratch.txt'), 'x');
const tracked = git(main, 'check-ignore', '-q', join('.claude', '.tmp', 'scratch.txt')).status === 0 && git(main, 'check-ignore', '-q', join('.claude', 'worktrees', 'x', 'y.txt')).status === 0;
check('git ignores both folders and status stays clean', tracked && git(main, 'status', '--porcelain').stdout === '', git(main, 'status', '--porcelain').stdout);

const added = git(main, 'worktree', 'add', join(layout.worktrees, 'a'), '-b', 'eng/a');
const wtA = join(layout.worktrees, 'a');
const fromWorktree = resolveLayout(wtA, 'claude');
check('a worktree resolves scratch to itself and worktrees to the main checkout',
  added.status === 0 && same(fromWorktree.top, wtA) && same(fromWorktree.mainTop, main) && same(fromWorktree.worktrees, layout.worktrees)
  && fwd(fromWorktree.tmp) === fwd(join(fromWorktree.top, '.claude', '.tmp')), `${added.stderr} ${JSON.stringify(fromWorktree)}`);
const nested = resolveLayout(join(wtA, 'sub', 'dir'), 'claude');
check('a subdirectory of a worktree resolves the same layout', nested !== null && same(nested.top, wtA), JSON.stringify(nested));
check('git status of the main checkout stays clean with a worktree in the folder', git(main, 'status', '--porcelain').stdout === '', git(main, 'status', '--porcelain').stdout);
const plain = join(base, 'plain');
mkdirSync(plain, { recursive: true });
check('a directory outside git has no layout and no advice', resolveLayout(plain, 'claude') === null && adviseWrite(join(elsewhere, 'x'), { cwd: plain }) === null
  && adviseCommand('git worktree add ../x', { cwd: plain }) === null, '');

// A linked worktree whose main checkout cannot be established must not nest worktrees or invent a home.
const sepMain = join(base, 'repos', 'sep-main');
const sepGit = join(base, 'repos', 'sep.git');
mkdirSync(sepMain, { recursive: true });
git(base, 'init', '-q', '-b', 'main', '--separate-git-dir', sepGit, sepMain);
git(sepMain, 'commit', '-q', '--allow-empty', '-m', 'init');
const sepWt = join(base, 'repos', 'sep-wt');
const sepAdded = git(sepMain, 'worktree', 'add', sepWt, '-b', 'eng/sep');
const sepMainLayout = resolveLayout(sepMain, 'claude');
const sepLayout = resolveLayout(sepWt, 'claude');
check('the main checkout of a --separate-git-dir repository keeps its worktrees folder', sepAdded.status === 0 && same(sepMainLayout.mainTop, sepMain) && Boolean(sepMainLayout.worktrees), sepAdded.stderr);
check('a linked worktree of a --separate-git-dir repository has no worktrees folder and gets no worktree advice',
  sepLayout !== null && same(sepLayout.top, sepWt) && sepLayout.mainTop === null && sepLayout.worktrees === null
  && adviseCommand('git worktree add ../x -b eng/x', { cwd: sepWt, host: 'claude' }) === null, JSON.stringify(sepLayout));
check('ensureLayout on a layout with no worktrees folder creates the scratch folder only', ensureLayout(sepLayout).length === 1 && existsSync(join(sepLayout.tmp, '.gitignore')), '');

// A stale gitfile names a common directory that is gone: no phantom tree appears for it.
const staleDir = join(base, 'repos', 'stale');
const goneRoot = join(base, 'gone');
mkdirSync(staleDir, { recursive: true });
writeFileSync(join(staleDir, '.git'), `gitdir: ${fwd(join(goneRoot, '.git', 'worktrees', 'x'))}\n`);
const staleLayout = resolveLayout(staleDir, 'claude');
check('a stale gitfile gives no main checkout, and ensureLayout creates no phantom tree',
  staleLayout !== null && staleLayout.mainTop === null && staleLayout.worktrees === null && ensureLayout(staleLayout).length === 1 && !existsSync(goneRoot), JSON.stringify(staleLayout));

// On Windows a rooted /c/x is a Git Bash drive path; any other rooted form cannot be placed, so it is silent.
if (process.platform === 'win32') {
  const driveNote = adviseCommand('git worktree add /c/x -b eng/x', { cwd: main, host: 'claude' });
  check('win32: /c/x maps to C:/x', typeof driveNote === 'string' && driveNote.includes('puts a worktree in C:/,'), String(driveNote));
  check('win32: other rooted forms are silent', ['/xy/z', '//host/share/y', '/cc/y'].every((p) => adviseCommand(`git worktree add ${p} -b eng/x`, { cwd: main, host: 'claude' }) === null), '');
}

// ---- CLI -------------------------------------------------------------------------------------
let r = run(cli, ['path', 'tmp', '--cwd', wtA, '--host', 'claude']);
check('path tmp names the worktree scratch folder', r.status === 0 && r.stdout.trim() === fwd(fromWorktree.tmp), r.stdout + r.stderr);
r = run(cli, ['path', 'worktrees', '--cwd', wtA, '--host', 'codex']);
check('path worktrees names the main checkout folder for the host', r.status === 0 && r.stdout.trim() === fwd(join(main, '.codex-work', 'worktrees')), r.stdout + r.stderr);
r = run(cli, ['ensure', '--cwd', main, '--host', 'opencode']);
check('ensure creates the folders for the named host', r.status === 0 && existsSync(join(main, '.opencode', 'worktrees', '.gitignore')) && existsSync(join(main, '.opencode', '.tmp', '.gitignore')), r.stdout + r.stderr);
r = run(cli, ['path', '--cwd', plain]);
check('path outside git exits 2', r.status === 2, r.stdout + r.stderr);
r = run(cli, ['path', '--host', 'nope', '--cwd', main]);
check('an unknown host exits 2', r.status === 2, r.stderr);
const stray = join(base, 'repos', 'stray-wt');
const managed = join(codexHome, 'worktrees', 'm');
git(main, 'worktree', 'add', stray, '-b', 'eng/stray');
git(main, 'worktree', 'add', managed, '-b', 'eng/managed');
r = run(cli, ['check', '--cwd', main, '--host', 'claude'], { CODEX_HOME: codexHome });
const labels = (text) => Object.fromEntries(text.split('\n').filter(Boolean).map((line) => [line.slice(14).trim(), line.slice(0, 13).trim()]));
const seen = labels(r.stdout);
check('check labels main, in-layout, host-managed, and stray worktrees and exits 0',
  r.status === 0 && seen[fwd(main)] === 'main' && seen[fwd(wtA)] === 'in-layout' && seen[fwd(managed)] === 'host-managed' && seen[fwd(stray)] === 'stray', r.stdout);
r = run(cli, ['check', '--strict', '--cwd', main, '--host', 'claude'], { CODEX_HOME: codexHome });
check('check --strict exits 1 on a stray worktree', r.status === 1, r.stdout + r.stderr);
git(main, 'worktree', 'remove', '--force', stray);
rmSync(join(layout.worktrees, '.gitignore'));
r = run(cli, ['check', '--strict', '--cwd', main, '--host', 'claude'], { CODEX_HOME: codexHome });
check('check --strict reports a folder with no ignore file', r.status === 1 && /no ignore\s+.*worktrees/.test(r.stdout), r.stdout);
r = run(cli, ['check', '--cwd', main, '--host', 'claude'], { CODEX_HOME: codexHome });
check('check without --strict exits 0 even then', r.status === 0, r.stdout);
ensureLayout(layout);
r = run(cli, ['check', '--strict', '--cwd', main, '--host', 'claude'], { CODEX_HOME: codexHome });
check('check --strict passes once the folders are ready', r.status === 0, r.stdout + r.stderr);
writeFileSync(join(layout.tmp, '.gitignore'), 'custom\n');
r = run(cli, ['check', '--strict', '--cwd', main, '--host', 'claude'], { CODEX_HOME: codexHome });
check('check --strict reports an ignore file with no * line', r.status === 1 && /no ignore\s+.*\.tmp/.test(r.stdout), r.stdout);
writeFileSync(join(layout.tmp, '.gitignore'), '*\n');
const sepInLayout = join(sepMainLayout.worktrees, 'in');
git(sepMain, 'worktree', 'add', sepInLayout, '-b', 'eng/in');
r = run(cli, ['check', '--strict', '--cwd', sepWt, '--host', 'claude']);
const sepSeen = labels(r.stdout);
check('with no known main checkout, check labels worktrees unknown and --strict does not call them stray',
  r.status === 0 && sepSeen[fwd(sepInLayout)] === 'unknown' && !/^stray/m.test(r.stdout), r.stdout + r.stderr);
r = run(join(root, 'scripts', 'co.mjs'), ['workspace', 'path', 'tmp', '--cwd', main, '--host', 'claude']);
check('co workspace reaches the script', r.status === 0 && r.stdout.trim() === fwd(layout.tmp), r.stdout + r.stderr);

// ---- the write advisory ----------------------------------------------------------------------
const repo = makeRepo('guarded');
const L = resolveLayout(repo, 'claude');
const claudeTmp = join(base, 'claudetmp');
for (const [label, file] of [
  ['inside the repository', join(repo, 'src', 'a.txt')], ['a relative path', 'src/a.txt'], ['the scratch folder', join(L.tmp, 'n.md')],
  ['the host temp directory (the scratchpad)', join(hosttmp, 'claude', 'scratchpad', 's.md')], ['~/.claude', join(home, '.claude', 'x.md')],
  ['~/.codex', join(home, '.codex', 'x.md')], ['CODEX_HOME', join(codexHome, 'x.md')], ['~/.grok', join(home, '.grok', 'x.md')],
  ['~/.config/opencode', join(home, '.config', 'opencode', 'x.md')], ['~/.copilot', join(home, '.copilot', 'x.md')], ['CODE_OPS_HOME', join(opsHome, 'x.md')],
  ['CLAUDE_CODE_TMPDIR', join(claudeTmp, 'x.md')],
]) {
  const extra = label === 'CODEX_HOME' ? { CODEX_HOME: codexHome } : label === 'CODE_OPS_HOME' ? { CODE_OPS_HOME: opsHome } : label === 'CLAUDE_CODE_TMPDIR' ? { CLAUDE_CODE_TMPDIR: claudeTmp } : {};
  check(`a write to ${label} is silent`, silent(hook(write(repo, file), extra)), hook(write(repo, file), extra).stdout);
}
const repoWt = join(L.worktrees, 'w');
git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
ensureLayout(L);
git(repo, 'worktree', 'add', repoWt, '-b', 'eng/w');
check('a write into the main checkout from a worktree is silent', silent(hook(write(repoWt, join(repo, 'src', 'a.txt')))), '');

const s1 = 'ws-once';
r = hook(write(repo, join(elsewhere, 'a', 'one.md'), s1));
const first = speaks(r);
check('a write outside every allowed root earns one advisory line naming the scratch folder',
  Boolean(first) && first.split('\n').length === 1 && first.includes(fwd(L.tmp)) && /fine if the user asked/.test(first), r.stdout + r.stderr);
check('the same session and directory is not told twice', silent(hook(write(repo, join(elsewhere, 'a', 'two.md'), s1))), '');
check('another directory in the same session is told', Boolean(speaks(hook(write(repo, join(elsewhere, 'b', 'one.md'), s1)))), '');
check('the same directory in a new session is told', Boolean(speaks(hook(write(repo, join(elsewhere, 'a', 'one.md'))))), '');
check('the advisory is the same for Edit, MultiEdit, and NotebookEdit', ['Edit', 'MultiEdit'].every((tool) => Boolean(speaks(hook(write(repo, join(elsewhere, tool, 'f.md'), undefined, tool)))))
  && Boolean(speaks(hook(call(repo, 'NotebookEdit', { notebook_path: join(elsewhere, 'nb', 'f.ipynb') })))), '');
check('a Read outside the repository is silent', silent(hook(call(repo, 'Read', { file_path: join(elsewhere, 'r.md') }))), '');
check('apply_patch and an unknown tool are silent', silent(hook(call(repo, 'apply_patch', { input: '*** Begin Patch' }))) && silent(hook(call(repo, 'mcp__x__save', { file_path: join(elsewhere, 'm.md') }))), '');
check('a write from a directory outside git is silent', silent(hook(write(plain, join(elsewhere, 'p', 'f.md')))), '');
check('a call with no session id is silent', silent(hook({ ...write(repo, join(elsewhere, 'ns', 'f.md')), session_id: undefined })), '');
r = hook({ toolName: 'Write', toolInput: { file_path: join(elsewhere, 'grok', 'f.md') }, sessionId: 'ws-grok', cwd: repo }, { GROK_PLUGIN_ROOT: suite });
check('a Grok camelCase payload gets the Grok folder in its line', speaks(r)?.includes(fwd(resolveLayout(repo, 'grok').tmp)) === true, r.stdout);
for (const value of ['off', '0', 'FALSE']) {
  check(`CODE_OPS_WORKSPACE_GUARD=${value} silences the advisory`, silent(hook(write(repo, join(elsewhere, 'sw', 'f.md')), { CODE_OPS_WORKSPACE_GUARD: value })), '');
}
check('CODE_OPS_DISPATCH_GUARD=off silences it too', silent(hook(write(repo, join(elsewhere, 'sw', 'g.md')), { CODE_OPS_DISPATCH_GUARD: 'off' })), '');
for (const bad of ['', '{not json', '[]', 'null', '"text"', '42']) {
  check(`a malformed payload (${JSON.stringify(bad).slice(0, 12)}) yields no output`, silent(hook(bad)), hook(bad).stdout);
}
check('a string tool_input and a numeric path yield no output', silent(hook(call(repo, 'Write', 'text'))) && silent(hook(call(repo, 'Write', { file_path: 5 }))), '');

// ---- the worktree advisory -------------------------------------------------------------------
const inTrees = fwd(L.worktrees);
const addLine = (text) => text.includes(`git worktree add ${inTrees}/<topic> -b eng/<topic>`);
const sibling = fwd(join(base, 'repos', 'sibling-wt'));
r = hook(shell(repo, `git worktree add ${sibling} -b eng/s1`));
const wtNote = speaks(r);
check('a git worktree add outside the worktrees folder gives the exact form', Boolean(wtNote) && addLine(wtNote) && /named? the branch|names the branch/.test(wtNote) && wtNote.split('\n').length === 1, r.stdout);
const fresh = makeRepo('fresh');
check('a ready folder adds no ensure command, a folder without an ignore file does',
  !/ensure first/.test(wtNote ?? '') && /ensure first/.test(speaks(hook(shell(fresh, 'git worktree add ../fresh-wt -b eng/f'))) ?? ''), wtNote);
check('a relative path outside the folder is advised too', Boolean(speaks(hook(shell(repo, 'git worktree add ../rel-wt -b eng/rel')))), '');
const onceSession = 'ws-wt-twice';
speaks(hook(shell(repo, `git worktree add ${sibling}-4 -b eng/s4`, onceSession)));
check('a second add into the same parent in one session is silent', silent(hook(shell(repo, `git worktree add ${sibling}-5 -b eng/s5`, onceSession))), '');
check('a worktree add inside the worktrees folder is silent', silent(hook(shell(repo, `git worktree add ${inTrees}/topic -b eng/topic`))) && silent(hook(shell(repo, 'git worktree add .claude/worktrees/t2 -b eng/t2'))), '');
check('one leading cd is followed', silent(hook(shell(plain, `cd ${fwd(repo)} && git worktree add .claude/worktrees/t3 -b eng/t3`)))
  && Boolean(speaks(hook(shell(plain, `cd ${fwd(repo)} && git worktree add ../cd-wt -b eng/cd`)))), '');
check('git -C is followed', silent(hook(shell(plain, `git -C ${fwd(repo)} worktree add .claude/worktrees/t4 -b eng/t4`))), '');
check('options with values and -- are read', silent(hook(shell(repo, `git worktree add --reason why -b eng/t5 -- ${inTrees}/t5`))) && silent(hook(shell(repo, `git worktree add --detach ${inTrees}/t6 HEAD`))), '');
const unparseable = [
  'git worktree add $WT/x -b eng/x', 'git worktree add "$(pwd)/x" -b eng/x', 'git worktree add `pwd`/x', '(cd x && git worktree add ../y)', 'git worktree add ../y; echo done',
  'cd a && cd b && git worktree add ../y', 'cd $D && git worktree add ../z', 'echo hi && git worktree add ../y', 'git worktree add ../y | cat', 'git worktree add ../y &',
  'git worktree add ../*', 'git worktree add "../open', 'git worktree add\n../y', 'git --git-dir=x worktree add ../y', 'git worktree add ..\\y -b eng/y', 'cd - && git worktree add ../y',
  'git worktree add ~other/y', 'cd && git worktree add ../y',
];
for (const command of unparseable) check(`an unparseable command is silent: ${JSON.stringify(command).slice(0, 48)}`, silent(hook(shell(repo, command))), hook(shell(repo, command)).stdout);
check('other git commands and other tools are silent', ['git status', 'git worktree list', 'git worktree remove ../x', 'git add .', 'ls'].every((c) => silent(hook(shell(repo, c))))
  && silent(hook(call(repo, 'Read', { command: 'git worktree add ../y' }))), '');
check('a PowerShell command reads backslashes as literal', Boolean(speaks(hook(shell(repo, `git worktree add ${join(base, 'repos', 'ps-wt')} -b eng/ps`, undefined, 'PowerShell')))), '');

// ---- composition with the guard's other behaviours -------------------------------------------
const subagent = (command, session) => ({ ...shell(repo, command, session), agent_id: 'agent-ws' });
const both = 'git worktree add ../deny-wt -b eng/deny && git checkout main';
r = hook(subagent(both, 'ws-deny'));
const denied = out(r);
check('a subagent git denial is unchanged and its text names the worktrees folder',
  denied?.permissionDecision === 'deny' && denied.updatedInput === undefined && !/Workspace note:/.test(denied.permissionDecisionReason ?? '')
  && (denied.permissionDecisionReason ?? '').includes(`git worktree add ${inTrees}/<topic> HEAD`), r.stdout);
r = hook(subagent('git worktree add ../deny-wt -b eng/deny', 'ws-deny'));
check('a denial leaves the once-only mark unspent', Boolean(speaks(r)), r.stdout);
r = hook({ ...subagent(both, 'ws-deny-plain'), cwd: plain });
check('the denial text keeps the placeholder outside a repository', (out(r)?.permissionDecisionReason ?? '').includes('git worktree add <scratch dir> HEAD'), r.stdout);
const spaced = makeRepo('with space');
const spacedTrees = fwd(resolveLayout(spaced, 'claude').worktrees);
r = hook({ ...subagent(both, 'ws-deny-space'), cwd: spaced });
check('the denial text quotes a worktrees folder that contains a space', (out(r)?.permissionDecisionReason ?? '').includes(`git worktree add "${spacedTrees}/<topic>" HEAD`), r.stdout);
r = hook({ ...subagent(both, 'ws-deny-sep'), cwd: sepWt });
check('the denial text keeps the placeholder when the worktrees folder is unknown', (out(r)?.permissionDecisionReason ?? '').includes('git worktree add <scratch dir> HEAD'), r.stdout);
r = hook(subagent(both, 'ws-deny-off'), { CODE_OPS_WORKSPACE_GUARD: 'off' });
check('the off switch restores the old denial text', (out(r)?.permissionDecisionReason ?? '').includes('git worktree add <scratch dir> HEAD'), r.stdout);
r = hook(subagent(both, 'ws-warn'), { CODE_OPS_DISPATCH_GUARD: 'warn' });
check('warn mode keeps the denial as advisory text beside the note', out(r)?.permissionDecision === undefined && /Subagent git guard:/.test(out(r)?.additionalContext ?? '') && /Workspace note:/.test(out(r)?.additionalContext ?? ''), r.stdout);

// The lead streak counts one per hands-on call: the advised call and two silent ones reach 3 together.
const streak = { CODE_OPS_LEAD_STREAK: '3' };
const sid = 'ws-streak';
const s = [hook(write(repo, join(elsewhere, 'st', 'f.md'), sid), streak), hook(write(repo, join(repo, 'a.txt'), sid), streak), hook(write(repo, join(repo, 'b.txt'), sid), streak)];
check('the advisory does not count toward the lead streak', Boolean(note(s[0])) && !/Lead inline streak/.test(s[0].stdout) && silent(s[1]) && /Lead inline streak: 3/.test(out(s[2])?.additionalContext ?? ''), s.map((x) => x.stdout).join('|'));

// Decision rows: an advisory is one row under its own gate id.
rmSync(dirname(receipts), { recursive: true, force: true });
hook(write(repo, join(elsewhere, 'row', 'f.md'), 'ws-row'));
const rows = existsSync(join(dirname(receipts), 'guard-decisions.jsonl')) ? readFileSync(join(dirname(receipts), 'guard-decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
check('an advisory writes one decision row under workspace-note', rows.length === 1 && JSON.stringify(rows[0].gates) === '["workspace-note"]' && rows[0].decision === 'advisory', JSON.stringify(rows));

// A hook copied without the library fails open.
const iso = join(base, 'iso');
mkdirSync(iso, { recursive: true });
for (const file of ['dispatch-guard.mjs', 'agent-file.mjs']) copyFileSync(join(suite, 'hooks', file), join(iso, file));
check('a missing library fails open', silent(hook(write(repo, join(elsewhere, 'iso', 'f.md')), {}, join(iso, 'dispatch-guard.mjs'))), '');

check('no advisory output carries permissionDecision or updatedInput', advisories.length >= 8 && advisories.every((text) => !/permissionDecision|updatedInput/.test(text)), `${advisories.length} outputs`);

// ---- the SessionStart card -------------------------------------------------------------------
const cardRepo = makeRepo('card');
const cardLayout = resolveLayout(cardRepo, 'claude');
const live = (cwd, extra, source = 'startup') => run(card, { hook_event_name: 'SessionStart', source, session_id: 'card-1', cwd }, extra);
r = live(cardRepo);
check('a live card names the scratch and worktree folders and creates them',
  r.status === 0 && r.stdout.includes(`workspace: scratch files in ${fwd(cardLayout.tmp)}; worktrees in ${fwd(cardLayout.worktrees)}`)
  && existsSync(join(cardLayout.tmp, '.gitignore')) && existsSync(join(cardLayout.worktrees, '.gitignore')), r.stdout + r.stderr);
check('a card with both folders ready says they are git-ignored', /; both are git-ignored/.test(r.stdout), r.stdout);
r = live(cardRepo, { CODEX_THREAD_ID: 'x' });
check('the card uses the host folder', r.stdout.includes(fwd(join(cardRepo, '.codex-work', '.tmp'))), r.stdout);
r = live(cardRepo, { CODEX_HOME: codexHome });
check('a lone CODEX_HOME is not Codex, so the card keeps the Claude folder', r.stdout.includes(fwd(join(cardRepo, '.claude', '.tmp'))) && !r.stdout.includes('.codex-work'), r.stdout);
const cardFile = makeRepo('card-file');
writeFileSync(join(cardFile, '.claude'), 'not a folder');
r = live(cardFile);
check('the card omits git-ignored when setup fails', r.status === 0 && /workspace: scratch files in /.test(r.stdout) && !/git-ignored/.test(r.stdout), r.stdout);
r = live(sepWt);
check('the card omits the worktrees part when the main checkout is unknown', /workspace: scratch files in \S+; it is git-ignored/.test(r.stdout) && !/worktrees in/.test(r.stdout), r.stdout);
git(home, 'init', '-q', '-b', 'main');
r = live(home);
check('a repository at the home directory is skipped: no folders, no git-ignored claim', r.status === 0 && !existsSync(join(home, '.claude', '.tmp')) && !/git-ignored/.test(r.stdout), r.stdout);
const cardOff = makeRepo('card-off');
r = live(cardOff, { CODE_OPS_WORKSPACE_GUARD: 'off' });
check('the off switch skips the line and the folders', r.status === 0 && !/workspace:/.test(r.stdout) && !existsSync(join(cardOff, '.claude')), r.stdout);
r = live(plain);
check('a card outside git has no workspace line', r.status === 0 && !/workspace:/.test(r.stdout), r.stdout);
const cardEmpty = makeRepo('card-empty');
r = run(card, '', {}, cardEmpty);
check('empty stdin (the baked dist) makes no line and no folders', r.status === 0 && !/workspace:/.test(r.stdout) && !existsSync(join(cardEmpty, '.claude')), r.stdout);

// Grok ignores hook stdout and its stdin is unverified: setup runs from the process working directory
// with no stdin read, and nothing prints.
const grokRepo = makeRepo('grok-card');
const grokOther = makeRepo('grok-other');
const grokEnv = { GROK_PLUGIN_ROOT: suite };
r = run(card, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'card-grok', cwd: grokOther }, grokEnv, grokRepo);
check('Grok runs setup from the process working directory and prints nothing',
  silent(r) && existsSync(join(grokRepo, '.grok', '.tmp', '.gitignore')) && existsSync(join(grokRepo, '.grok', 'worktrees', '.gitignore')) && !existsSync(join(grokOther, '.grok')), r.stdout + r.stderr);
const grokOff = makeRepo('grok-off');
check('Grok setup honors CODE_OPS_WORKSPACE_GUARD and CODE_OPS_ROUTING_CARD',
  silent(run(card, '', { ...grokEnv, CODE_OPS_WORKSPACE_GUARD: 'off' }, grokOff)) && !existsSync(join(grokOff, '.grok'))
  && silent(run(card, '', { ...grokEnv, CODE_OPS_ROUTING_CARD: 'off' }, grokOff)) && !existsSync(join(grokOff, '.grok')), '');
check('Grok outside a repository prints nothing and creates nothing', silent(run(card, '', grokEnv, plain)) && !existsSync(join(plain, '.grok')), '');

rmSync(base, { recursive: true, force: true, maxRetries: 3 });
console.log(fails.length ? `workspace-layout: ${fails.length} failure(s)\n${fails.join('\n')}` : 'workspace-layout: all checks pass');
process.exit(fails.length ? 1 : 0);
