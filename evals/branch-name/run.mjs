#!/usr/bin/env node
// Branch-name gate regression eval: the rule (scripts/branch-name.mjs), its command reader, the
// enforce-traceless tool hook, and the tracked pre-commit and pre-push git hooks.
//
//   node evals/branch-name/run.mjs   (exit 0 = pass)
//
// The rule cases are pure. The command reader cases inject the current branch, so they need no
// repository. The hook and git-hook cases build throwaway repositories under the OS temp dir and
// run the real hook files against them. The CI step is a one-line call of the same CLI.

import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchNameProblems, commandBranchViolations } from '../../scripts/branch-name.mjs';
import { tally } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { fails, check } = tally();

// ---- 1. the rule -------------------------------------------------------------------------
const MUST_FAIL = [
  'claude/code-ops-session-limits-jis1gr', 'codex/handoff-lifecycle-release',
  'claude/beautiful-lehmann-0bd3b1', 'claude/heuristic-varahamihira-92cf63',
  'Claude/x', 'copilot/fix-it', 'cursor/x', 'gemini/x', 'grok/x', 'opencode/x', 'aider/x', 'devin/x',
  'chatgpt/x', 'gpt/x', 'openai/x', 'anthropic/x', 'ai/x', 'agent/x', 'worktree/x',
  'claude-fix', 'codex_fix', 'worktree-agent-a306386c09435cc0b',
  'eng/beautiful-lehmann-0bd3b1', 'fix/zen-ladder-x7k2m9',
];
const MUST_PASS = [
  'main', 'eng/ci-baseline', 'eng/p8-u3-org', 'eng/r1-doctrine', 'eng/compact-fidelity',
  'eng/codex-render', 'eng/p6-record-fix', 'fix/check22-round2', 'fix/metrics-evals2', 'docs/v2',
  'eng/ho11', 'eng/release-20261007', 'fix/claude-md-link', 'eng/agents-contract', 'feature/use-gpt-tier',
  'dependabot/github_actions/actions/checkout-7.0.1',
];
for (const name of MUST_FAIL) check(`rule fails ${name}`, branchNameProblems(name).length > 0);
for (const name of MUST_PASS) check(`rule passes ${name}`, branchNameProblems(name).length === 0);
check('prefix and token are separate problems', branchNameProblems('claude/beautiful-lehmann-0bd3b1').length === 2);

// ---- 2. the command reader (current branch injected) -------------------------------------
const CWD = process.cwd();
const READER_CASES = [
  ['git checkout -b claude/foo', 'claude/foo'],
  ['git checkout -B codex/foo origin/main', 'codex/foo'],
  ['git switch -c eng/ok-name-0a1b2c', 'eng/ok-name-0a1b2c'],
  ['git switch -C claude/x', 'claude/x'],
  ['git checkout --orphan claude/x', 'claude/x'],
  ['git branch claude/foo', 'claude/foo'],
  ['git branch claude/foo main', 'claude/foo'],
  ['git branch -m old claude/foo', 'claude/foo'],
  ['git branch -M claude/foo', 'claude/foo'],
  ['git branch -c eng/a codex/b', 'codex/b'],
  ['git worktree add -b claude/foo ../wt', 'claude/foo'],
  ['git worktree add -B codex/foo ../wt main', 'codex/foo'],
  ['git worktree add ../claude-thing', 'claude-thing'],
  ['git push origin HEAD:codex/foo', 'codex/foo'],
  ['git push -u origin +eng/ok:refs/heads/claude/foo', 'claude/foo'],
  ['git push origin claude/foo', 'claude/foo'],
  ['gh pr create --head claude/foo --title "Fix it"', 'claude/foo'],
  ['gh pr create --title t -H someone:codex/foo', 'codex/foo'],
  ['gh pr create --head=claude/foo', 'claude/foo'],
  ['cd /tmp && git checkout -b claude/foo', 'claude/foo'],
  ['git -C ../other -c core.x=y checkout -b claude/foo', 'claude/foo'],
  ['git status && git switch -c codex/foo', 'codex/foo'],
];
const READER_CLEAN = [
  'git status --short', 'git log --oneline -5 main', 'git checkout -b eng/ok', 'git switch -c fix/ok-name',
  'git checkout main', 'git checkout -- src/a.txt', 'git branch', 'git branch -a', 'git branch --show-current',
  'git branch -d claude/old', 'git branch -D codex/old', 'git branch -m eng/new', 'git branch -u origin/main',
  'git branch --contains codex/foo', 'git push origin --delete claude/old', 'git push origin :codex/old',
  'git push origin v1.0 --tags', 'git push origin eng/ok', 'git worktree add -b eng/ok ../wt',
  'git worktree add ../wt main', 'git worktree list', 'git worktree remove ../claude-thing',
  'echo "git checkout -b claude/foo"', 'rg "git push origin codex/foo" notes.md',
  'cat > note.md <<EOF\ngit checkout -b claude/foo\nEOF', 'gh pr create --head eng/ok --title t',
  'git commit -m "Move off claude/foo"', 'gh pr view claude/foo',
];
const onBranch = (name) => () => name;
for (const [command, want] of READER_CASES) {
  const got = commandBranchViolations(command, CWD, onBranch('eng/ok')).map((v) => v.name);
  check(`reader flags ${command}`, got.length === 1 && got[0] === want, `got ${JSON.stringify(got)}`);
}
for (const command of READER_CLEAN) {
  const got = commandBranchViolations(command, CWD, onBranch('eng/ok')).map((v) => v.name);
  check(`reader allows ${JSON.stringify(command)}`, got.length === 0, `got ${JSON.stringify(got)}`);
}
// Commands that run on the current branch.
for (const command of ['git commit -m x', 'git commit --amend --no-edit', 'git push', 'git push origin HEAD', 'gh pr create --title t']) {
  const got = commandBranchViolations(command, CWD, onBranch('claude/foo')).map((v) => v.name);
  check(`reader checks the current branch for ${command}`, got.length === 1 && got[0] === 'claude/foo', `got ${JSON.stringify(got)}`);
  check(`reader passes ${command} on a topic branch`, commandBranchViolations(command, CWD, onBranch('eng/ok')).length === 0);
}
check('reader passes a commit on a detached HEAD', commandBranchViolations('git commit -m x', CWD, () => null).length === 0);
check('reader fails open when git cannot answer', commandBranchViolations('git commit -m x', CWD, () => { throw new Error('no repo'); }).length === 0);
// The branch a same-command rename or switch leaves current replaces the stale one.
check('reader follows a rename into the commit', commandBranchViolations('git branch -m eng/good && git commit -m x', CWD, onBranch('claude/old')).length === 0);
check('reader follows a switch into the commit', commandBranchViolations('git switch -c eng/good && git commit -m x', CWD, onBranch('claude/old')).length === 0);
check('reader treats a plain checkout as an unknown branch', commandBranchViolations('git checkout main && git commit -m x', CWD, onBranch('claude/old')).length === 0);
check('reader keeps checking a commit after a bad rename', commandBranchViolations('git branch -m codex/bad && git commit -m x', CWD, onBranch('eng/ok')).length === 2);
check('reader resolves cd for the current branch', (() => {
  const seen = [];
  commandBranchViolations('cd sub && git commit -m x', CWD, (dir) => { seen.push(dir); return 'eng/ok'; });
  return seen.length === 1 && seen[0] === resolve(CWD, 'sub');
})());
check('reader resolves -C for the current branch', (() => {
  const seen = [];
  commandBranchViolations('git -C sub commit -m x', CWD, (dir) => { seen.push(dir); return 'eng/ok'; });
  return seen.length === 1 && seen[0] === resolve(CWD, 'sub');
})());

// ---- 3. repositories: the CLI, the tool hook, and the git hooks --------------------------
const work = mkdtempSync(join(tmpdir(), 'code-ops-branch-name-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const GIT_ENV = { ...process.env, GIT_CEILING_DIRECTORIES: work, GIT_CONFIG_GLOBAL: join(work, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
writeFileSync(join(work, 'gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
const node = (cwd, file, ...args) => spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8', env: GIT_ENV });
const cli = join(ROOT, 'scripts', 'branch-name.mjs');
const hook = join(ROOT, 'plugins', 'code-ops-suite', 'hooks', 'enforce-traceless.mjs');

function repo(name, branch) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', branch);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'seed');
  return dir;
}
const bad = repo('bad', 'claude/beautiful-lehmann-0bd3b1');
const good = repo('good', 'eng/topic-branch');
const detached = repo('detached', 'eng/topic-branch');
git(detached, 'checkout', '-q', '--detach');
const empty = join(work, 'empty');
mkdirSync(empty);

const text = (r) => `${r.stdout}${r.stderr}`;
const cliBad = node(bad, cli, 'check');
check('cli exits 1 on a bad current branch', cliBad.status === 1, text(cliBad));
check('cli names the rule and the fix', /AI-tool name "claude"/.test(cliBad.stderr) && /generated random token/.test(cliBad.stderr) && /git branch -m <descriptive-name>/.test(cliBad.stderr) && /eng\/, fix\/, or docs\//.test(cliBad.stderr), cliBad.stderr);
check('cli exits 0 on a topic branch', node(good, cli, 'check').status === 0);
check('cli exits 0 on a detached HEAD', node(detached, cli, 'check').status === 0);
check('cli checks a named branch', node(good, cli, 'check', 'codex/x').status === 1 && node(bad, cli, 'check', 'eng/x').status === 0);
check('cli exits 2 outside a repository', node(empty, cli, 'check').status === 2);
check('cli exits 2 on bad usage', node(good, cli).status === 2 && node(good, cli, 'check', 'a', 'b').status === 2 && node(good, cli, 'list').status === 2);

const hookRun = (command, cwd, extra = {}) =>
  spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, ...(cwd ? { cwd } : {}), ...extra }), encoding: 'utf8', env: GIT_ENV, cwd: empty });
const HOOK_BLOCKED = [
  ['git commit -m "Fix it"', bad], ['git push origin HEAD', bad], ['git push', bad], ['gh pr create --title "Fix it"', bad],
  ['git checkout -b claude/foo', good], ['git switch -c codex/foo', good], ['git branch codex/foo', good],
  ['git branch -m claude/foo', good], ['git worktree add -b claude/foo ../wt', good],
  ['git push origin HEAD:codex/foo', good], ['gh pr create --head claude/foo --title "Fix it"', good],
  [`cd "${bad.split('\\').join('/')}" && git commit -m "Fix it"`, good],
  [`git -C "${bad.split('\\').join('/')}" commit -m "Fix it"`, good],
  ['git branch -m eng/ok && git branch codex/foo', good],
];
const HOOK_ALLOWED = [
  ['git status --short', bad], ['git log --oneline', bad], ['git branch -m eng/good-name', bad],
  ['git checkout -b eng/good-name', bad], ['git switch -c fix/good-name', bad],
  ['git branch -m eng/good-name && git commit -m "Fix it"', bad],
  ['git commit -m "Fix it"', good], ['git push origin HEAD', good], ['git push origin eng/topic-branch', good],
  ['gh pr create --title "Fix it"', good], ['git checkout -b eng/codex-render', good],
  ['git branch -D claude/old', good], ['git push origin --delete claude/old', bad],
  ['git commit -m "Fix it"', detached], ['git commit -m "Fix it"', empty],
  [`cd "${good.split('\\').join('/')}" && git commit -m "Fix it"`, bad],
];
for (const [command, cwd] of HOOK_BLOCKED) {
  const r = hookRun(command, cwd);
  check(`hook blocks ${command}`, r.status === 2 && /Branch-name gate/.test(r.stderr) && /git branch -m <descriptive-name>/.test(r.stderr), `status ${r.status} ${r.stderr.slice(0, 200)}`);
}
for (const [command, cwd] of HOOK_ALLOWED) {
  const r = hookRun(command, cwd);
  check(`hook allows ${command}`, r.status === 0, `status ${r.status} ${r.stderr.slice(0, 200)}`);
}
check('hook uses the process cwd when the payload has none', hookRun('git commit -m "Fix it"', null).status === 0);
check('hook still scans a commit message on a good branch', hookRun('git commit -m "Generated with Claude Code"', good).status === 2);
check('hook ignores a non-bash tool', spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Read', tool_input: { command: 'git checkout -b claude/x' } }), encoding: 'utf8' }).status === 0);

// The tracked git hooks, run by real git against a repository that carries the rule script.
function hooked(name, branch) {
  const dir = repo(name, branch);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, '.githooks'));
  cpSync(cli, join(dir, 'scripts', 'branch-name.mjs'));
  for (const h of ['pre-commit', 'pre-push']) {
    cpSync(join(ROOT, '.githooks', h), join(dir, '.githooks', h));
    chmodSync(join(dir, '.githooks', h), 0o755); // git ignores a hook without the executable bit
  }
  git(dir, 'config', 'core.hooksPath', '.githooks');
  return dir;
}
const commitIn = (dir) => {
  writeFileSync(join(dir, 'a.txt'), `${readFileSync(join(dir, 'a.txt'), 'utf8')}more\n`);
  git(dir, 'add', 'a.txt');
  return git(dir, 'commit', '-q', '-m', 'Change a');
};
const hookedBad = hooked('hooked-bad', 'codex/handoff-lifecycle-release');
const preCommitBad = commitIn(hookedBad);
check('pre-commit aborts a commit on a bad branch', preCommitBad.status !== 0 && /Commit aborted/.test(preCommitBad.stderr) && /git branch -m <descriptive-name>/.test(preCommitBad.stderr), text(preCommitBad));
git(hookedBad, 'branch', '-m', 'eng/handoff-lifecycle');
check('pre-commit allows the commit after the rename', git(hookedBad, 'commit', '-q', '-m', 'Change a').status === 0);
const hookedGood = hooked('hooked-good', 'eng/topic-branch');
check('pre-commit allows a commit on a topic branch', commitIn(hookedGood).status === 0);
git(hookedGood, 'checkout', '-q', '--detach');
check('pre-commit allows a commit on a detached HEAD', commitIn(hookedGood).status === 0);
const hookedNoScript = hooked('hooked-no-script', 'claude/x');
rmSync(join(hookedNoScript, 'scripts'), { recursive: true, force: true });
check('pre-commit skips the check when the rule script is absent', commitIn(hookedNoScript).status === 0);

const remote = join(work, 'remote.git');
git(work, 'init', '-q', '--bare', remote);
const pusher = hooked('pusher', 'eng/topic-branch');
git(pusher, 'remote', 'add', 'origin', remote);
const push = (...args) => git(pusher, 'push', '-q', ...args);
check('pre-push allows a topic branch', push('origin', 'eng/topic-branch').status === 0);
const badPush = push('origin', 'HEAD:refs/heads/claude/beautiful-lehmann-0bd3b1');
check('pre-push refuses a bad remote branch name', badPush.status !== 0 && /Push aborted/.test(badPush.stderr) && /AI-tool name "claude"/.test(badPush.stderr), text(badPush));
check('pre-push refuses a bad name among several refs', push('origin', 'HEAD:refs/heads/eng/fine-name', 'HEAD:refs/heads/codex/x').status !== 0);
check('pre-push leaves the bad ref unpublished', !/claude\//.test(git(remote, 'branch', '--list').stdout));
check('pre-push ignores a tag', (() => { git(pusher, 'tag', 'codex-v1'); return push('origin', 'codex-v1').status === 0; })());
check('pre-push allows deleting a bad remote branch', (() => {
  push('--no-verify', 'origin', 'HEAD:refs/heads/claude/old');
  const listed = /claude\/old/.test(git(remote, 'branch', '--list').stdout);
  return listed && push('origin', '--delete', 'claude/old').status === 0 && !/claude\/old/.test(git(remote, 'branch', '--list').stdout);
})());

// ---- 4. wiring: the installer, the CI step, and the vendored copy ------------------------
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
check('installer registers pre-push', /HOOK_NAMES = \[[^\]]*'pre-push'/.test(read('scripts', 'install-git-hooks.mjs')));
const workflow = read('.github', 'workflows', 'validate.yml');
check('CI passes the head ref through env', /HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/.test(workflow));
check('CI runs the CLI on the quoted env value', workflow.includes('node scripts/branch-name.mjs check "$HEAD_REF"'));
check('CI never inlines the head ref in a script', !/run:[^\n]*\$\{\{ github\.event\.pull_request\.head\.ref/.test(workflow));
check('the plugin carries a byte-identical rule script', read('plugins', 'code-ops-suite', 'scripts', 'branch-name.mjs') === read('scripts', 'branch-name.mjs'));

if (fails.length) {
  console.error('FAIL — branch-name eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — branch-name eval: the rule, the command reader, the tool hook, and the git hooks block AI-tool prefixes and generated names, and pass topic branches.');
