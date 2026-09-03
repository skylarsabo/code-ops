#!/usr/bin/env node
// Digest-rewrite hook regression eval — pins the opt-in PreToolUse stage
// (plugins/code-ops-suite/hooks/digest-rewrite.mjs) and the `--cwd` flag it depends on
// (scripts/digest.mjs) against fixture payloads fed on stdin.
//
// The claim under test is that a rewrite is rare, exact, and never a decision:
//   - with `CODE_OPS_DIGEST` unset every payload yields empty stdout and exit 0, and the same
//     holds for `off` and for a value the switch does not name;
//   - with the switch on, an allowlisted simple command becomes
//     `node "<...>/digest.mjs" [--cwd "<dir>"] -- <original tokens>`, and one leading
//     `cd <dir> &&` becomes `--cwd <dir>` rather than a shell;
//   - a pipe, an expansion, a structured-output flag, a command outside the allowlist, a
//     command already wrapped in the digest, an over-long command, and a payload for another
//     tool all pass through untouched;
//   - garbage stdin exits 0 with no output, so the hook can never cost a tool call;
//   - the permission branch is asserted explicitly: the installed host re-runs its permission
//     evaluation against `updatedInput`, so the hook returns NO `permissionDecision`;
//   - `additionalContext` is present, and identical, on every rewrite;
//   - the mutation control: a copy of the hook with the pipe removed from both the
//     metacharacter guard and the bare-token charset wraps `git diff | head`, so the contract
//     is proven able to fail, while removing it from one guard alone changes nothing, which is
//     what makes the second guard redundancy rather than the only thing holding;
//   - `--cwd` is proven end-to-end on the digest CLI itself, because the rewrite is worthless
//     if the flag it emits does not move the child's working directory.
//
//   node evals/digest-hook/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'digest-rewrite.mjs');
const cli = join(root, 'scripts', 'digest.mjs');

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };

const payloadFor = (command, extra = {}) => JSON.stringify({
  session_id: 'sess-digest-hook',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_use_id: 'toolu_1',
  tool_input: { command, description: 'fixture', ...extra },
});

// `on` is the switch value under test everywhere except the off-switch block below.
function runHook(input, value = 'on', script = hook) {
  const env = { ...process.env };
  if (value === null) delete env.CODE_OPS_DIGEST;
  else env.CODE_OPS_DIGEST = value;
  return spawnSync('node', [script], { input, encoding: 'utf8', cwd: root, env });
}

function rewriteOf(input, value = 'on', script = hook) {
  const r = runHook(input, value, script);
  if (r.status !== 0) return { status: r.status, out: r.stdout, json: null };
  if (r.stdout.trim() === '') return { status: r.status, out: r.stdout, json: null };
  try { return { status: r.status, out: r.stdout, json: JSON.parse(r.stdout) }; } catch { return { status: r.status, out: r.stdout, json: 'unparsable' }; }
}

const CONTEXT = 'Output digested by code-ops: elided regions carry a sed hint into the raw file '
  + 'named in the trailer. Run the original command only if you need the whole output.';

// Every payload the eval uses, rewritten or not, in one place so the off-switch block can
// replay the whole set.
const REWRITTEN = [
  ['git diff --stat', null],
  ['cd "C:/x y" && git status --short', '"C:/x y"'],
  ['cd scripts && ls', '"scripts"'],
  ['cd ../other && git log --oneline', '"../other"'],
  ['npm test', null],
  ['sed -n 1,40p scripts/digest.mjs', null],
];
const PASSED_THROUGH = [
  'git diff | head',
  'echo "$HOME"',
  'gh pr list --json number',
  'gh api repos/o/r/pulls',
  'node scripts/digest.mjs -- ls',
  'rm -rf x',
  'git status > out.txt',
  'git status; ls',
  'cat <<EOF',
  'cd a && cd b && ls',
  'cd ~/Documents && git log --oneline -2',
  'cd ~ && ls',
  'cd - && ls',
  'sed -n -i 1p x',
  'sed -ni 1p x',
  'sed -n --in-place=.bak 1p x',
  'sed -n --i 1p x',
  'sed -n --in-p 1p x',
  `git diff ${'a'.repeat(2500)}`,
];

// ---------------------------------------------------------------- the store switch

// CODE_OPS_DIGEST_STORE=off adds --no-store right after the script path and nothing else changes.
{
  const withStore = runHook(payloadFor('git diff --stat'), 'on');
  const noStore = spawnSync('node', [hook], { input: payloadFor('git diff --stat'), encoding: 'utf8', env: { ...process.env, CODE_OPS_DIGEST: 'on', CODE_OPS_DIGEST_STORE: 'off' } });
  const a = JSON.parse(withStore.stdout).hookSpecificOutput.updatedInput.command;
  const b = JSON.parse(noStore.stdout).hookSpecificOutput.updatedInput.command;
  expect(!a.includes('--no-store'), 'without the store switch the rewrite carries no --no-store');
  expect(b.includes('" --no-store -- git diff --stat'), `CODE_OPS_DIGEST_STORE=off must insert --no-store after the script path, got ${b}`);
  expect(b.replace(' --no-store', '') === a, 'the store switch changes nothing but the flag');
  const ctxOff = JSON.parse(noStore.stdout).hookSpecificOutput.additionalContext;
  const ctxOn = JSON.parse(withStore.stdout).hookSpecificOutput.additionalContext;
  expect(/not recoverable/.test(ctxOff) && !/sed hint/.test(ctxOff), `with the store off the context must not promise recovery, got ${ctxOff}`);
  expect(/sed hint/.test(ctxOn), 'with the store on the context names the recovery hint');
  const literal = runHook(payloadFor('git log --oneline --no-store'), 'on');
  const ctxLiteral = JSON.parse(literal.stdout).hookSpecificOutput.additionalContext;
  expect(/sed hint/.test(ctxLiteral), `a literal --no-store argument with the store on must keep the recovery line, got ${ctxLiteral}`);
}

// The digest itself honors the store switch, and the default store slug follows the directory
// the digest started in, never the --cwd target (DR-103 / S-2 / R-1).
{
  const home = mkdtempSync(join(tmpdir(), 'digest-home-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'digest-elsewhere-'));
  const digest = join(root, 'scripts', 'digest.mjs');
  const envHome = { ...process.env, HOME: home, USERPROFILE: home };
  delete envHome.CODE_OPS_DIGEST_DIR;
  const slugOf = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
  const r1 = spawnSync('node', [digest, '--json', '--cwd', elsewhere, '--', 'node', '-e', 'console.log(1)'], { cwd: root, encoding: 'utf8', env: envHome });
  expect(r1.status === 0, `digest --cwd should exit 0, got ${r1.status}: ${r1.stderr}`);
  try {
    const j = JSON.parse(r1.stdout);
    const dir = String(j.receipt && j.receipt.dir).split(/[\\/]/).pop();
    expect(dir === slugOf(root), `the store slug must follow the starting directory, got ${dir}`);
    expect(dir !== slugOf(elsewhere), 'the store slug must not follow the --cwd target');
  } catch { fails.push('digest --json must parse'); }
  const r2 = spawnSync('node', [digest, '--json', '--store', join(home, 'forced'), '--', 'node', '-e', 'console.log(1)'], { cwd: root, encoding: 'utf8', env: { ...envHome, CODE_OPS_DIGEST_STORE: 'off' } });
  expect(r2.status === 0 && JSON.parse(r2.stdout || '{}').receipt === null && !existsSync(join(home, 'forced')), 'CODE_OPS_DIGEST_STORE=off must stop the digest itself from storing, even with --store');
  rmSync(home, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the off switch

// The guard must return before the payload is read: an unset, `off`, or unrecognized switch
// must produce nothing at all, for every payload the on-switch block rewrites.
for (const value of [null, 'off', '0', 'false', 'yes', '']) {
  for (const [command] of REWRITTEN) {
    const r = runHook(payloadFor(command), value);
    const label = value === null ? 'unset' : JSON.stringify(value);
    expect(r.status === 0, `CODE_OPS_DIGEST=${label} must exit 0 for ${JSON.stringify(command)}, got ${r.status}`);
    expect(r.stdout === '', `CODE_OPS_DIGEST=${label} must print nothing for ${JSON.stringify(command)}, got ${JSON.stringify(r.stdout)}`);
    expect(r.stderr === '', `CODE_OPS_DIGEST=${label} must write no stderr, got ${JSON.stringify(r.stderr)}`);
  }
}

// ---------------------------------------------------------------- rewrites

for (const [command, cwd] of REWRITTEN) {
  const { status, json } = rewriteOf(payloadFor(command));
  expect(status === 0, `${JSON.stringify(command)} must exit 0, got ${status}`);
  if (json === null || json === 'unparsable') {
    fails.push(`${JSON.stringify(command)} must rewrite and print one parsable JSON object`);
    continue;
  }
  const out = json.hookSpecificOutput || {};
  expect(out.hookEventName === 'PreToolUse', `${command}: hookEventName must be PreToolUse, got ${out.hookEventName}`);
  const rewritten = out.updatedInput?.command;
  expect(typeof rewritten === 'string', `${command}: updatedInput.command must be a string`);
  if (typeof rewritten === 'string') {
    expect(rewritten.startsWith('node "'), `${command}: the rewrite must start with a quoted node script path, got ${JSON.stringify(rewritten.slice(0, 40))}`);
    expect(rewritten.includes('digest.mjs" '), `${command}: the rewrite must name digest.mjs, got ${JSON.stringify(rewritten.slice(0, 120))}`);
    const tail = cwd === null ? command : command.slice(command.indexOf('&&') + 2).trim();
    expect(rewritten.endsWith(` -- ${tail}`), `${command}: the rewrite must end with " -- ${tail}", got ${JSON.stringify(rewritten)}`);
    if (cwd !== null) expect(rewritten.includes(` --cwd ${cwd} -- `), `${command}: the rewrite must carry --cwd ${cwd}, got ${JSON.stringify(rewritten)}`);
    else expect(!rewritten.includes('--cwd'), `${command}: a command with no cd prefix must carry no --cwd, got ${JSON.stringify(rewritten)}`);
  }
  expect(out.updatedInput?.description === 'fixture', `${command}: the rest of the tool input must survive the rewrite, got ${JSON.stringify(out.updatedInput)}`);
  expect(out.additionalContext === CONTEXT, `${command}: additionalContext must be the digest line verbatim, got ${JSON.stringify(out.additionalContext)}`);

  // The permission branch, asserted by name. Version 2.1.257 of the installed host reassigns
  // the tool input to the hook's updatedInput and only then runs its permission evaluation
  // (offsets 188975121 and 188978021), so the hook must state no decision and let the
  // operator's own rules judge the rewritten command.
  expect(!Object.hasOwn(out, 'permissionDecision'),
    `${command}: branch "host re-evaluates against updatedInput". The hook must return NO permissionDecision, got ${JSON.stringify(out.permissionDecision)}`);
  expect(!Object.hasOwn(out, 'permissionDecisionReason'),
    `${command}: branch "host re-evaluates against updatedInput". No permissionDecisionReason belongs in the output, got ${JSON.stringify(out.permissionDecisionReason)}`);
}

// A background or timeout flag must not be dropped on the way through.
{
  const { json } = rewriteOf(payloadFor('git diff --stat', { run_in_background: true, timeout: 60000 }));
  const input = json && json !== 'unparsable' ? json.hookSpecificOutput?.updatedInput : null;
  expect(input?.run_in_background === true && input?.timeout === 60000,
    `the rewrite must carry every other tool_input field forward, got ${JSON.stringify(input)}`);
}

// ---------------------------------------------------------------- pass-throughs

for (const command of PASSED_THROUGH) {
  const r = runHook(payloadFor(command));
  expect(r.status === 0, `${JSON.stringify(command.slice(0, 40))} must exit 0, got ${r.status}`);
  expect(r.stdout === '', `${JSON.stringify(command.slice(0, 40))} must pass through untouched, got ${JSON.stringify(r.stdout.slice(0, 160))}`);
}

// Another tool, a missing command, and garbage stdin are all silent exit 0.
{
  const other = runHook(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'a.txt' } }));
  expect(other.status === 0 && other.stdout === '', `a Read payload must pass through, got ${other.status}/${JSON.stringify(other.stdout)}`);
  const noCommand = runHook(JSON.stringify({ tool_name: 'Bash', tool_input: {} }));
  expect(noCommand.status === 0 && noCommand.stdout === '', `a Bash payload with no command must pass through, got ${noCommand.status}/${JSON.stringify(noCommand.stdout)}`);
  const garbage = runHook('not json at all');
  expect(garbage.status === 0 && garbage.stdout === '', `garbage stdin must exit 0 with no output, got ${garbage.status}/${JSON.stringify(garbage.stdout)}`);
  const empty = runHook('');
  expect(empty.status === 0 && empty.stdout === '', `empty stdin must exit 0 with no output, got ${empty.status}/${JSON.stringify(empty.stdout)}`);
}

// ---------------------------------------------------------------- mutation control

// A pipe is refused twice: the metacharacter guard rejects the command before tokenizing, and
// the bare-token charset has no `|` in it either. The control measures both facts. A copy of
// the hook with the pipe removed from ONE guard must still pass `git diff | head` through, and
// a copy with it removed from BOTH must wrap it, so the contract is proven load-bearing, and
// the second guard is proven to be redundancy rather than the only thing holding.
//
// The copies live beside the hook because the hook resolves `../scripts/digest.mjs` from its
// own location and passes through when that file is missing.
const tmp = mkdtempSync(join(tmpdir(), 'digest-hook-'));
{
  // The mutant lives in a temp tree shaped like the plugin (hooks/ beside scripts/), so the
  // hook's sibling lookup finds a digest.mjs there and the tracked tree stays untouched.
  const mutantRoot = mkdtempSync(join(tmpdir(), 'digest-hook-mutant-'));
  mkdirSync(join(mutantRoot, 'hooks'), { recursive: true });
  mkdirSync(join(mutantRoot, 'scripts'), { recursive: true });
  writeFileSync(join(mutantRoot, 'scripts', 'digest.mjs'), readFileSync(join(root, 'scripts', 'digest.mjs')));
  const mutant = join(mutantRoot, 'hooks', 'digest-rewrite-mutant.mjs');
  const source = readFileSync(hook, 'utf8');
  const metachar = 'const METACHAR_RE = /[|&;<>`$\\n\\r]/;';
  const bare = String.raw`const BARE_RE = /^[A-Za-z0-9_./\\:@%+=,~^-]+$/;`;
  expect(source.includes(metachar), 'the mutation control needs the metacharacter guard to read as it does in the hook');
  expect(source.includes(bare), 'the mutation control needs the bare-token charset to read as it does in the hook');
  if (source.includes(metachar) && source.includes(bare)) {
    const oneGuard = source.replace(metachar, 'const METACHAR_RE = /[&;<>`$\\n\\r]/;');
    const bothGuards = oneGuard.replace(bare, String.raw`const BARE_RE = /^[A-Za-z0-9_./\\:@%+=,~^|-]+$/;`);
    try {
      writeFileSync(mutant, oneGuard);
      expect(runHook(payloadFor('git diff | head'), 'on', mutant).stdout === '',
        'with the pipe removed from the metacharacter guard alone, the token charset must still pass `git diff | head` through');
      writeFileSync(mutant, bothGuards);
      expect(runHook(payloadFor('git diff | head'), 'on', mutant).stdout !== '',
        'with the pipe removed from both guards the hook must wrap `git diff | head` — a contract that cannot fail proves nothing');
    } finally {
      rmSync(mutantRoot, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------- --cwd end to end

{
  const probe = spawnSync('node', [cli, '--no-store', '--cwd', tmp, '--', 'node', '-e', 'console.log(process.cwd())'], { encoding: 'utf8', cwd: root });
  expect(probe.status === 0, `the --cwd probe should exit 0, got ${probe.status}: ${probe.stderr}`);
  const printed = probe.stdout.split('\n')[0]?.trim().replaceAll('\\', '/');
  expect(printed === tmp.replaceAll('\\', '/'), `--cwd must move the child's working directory to ${tmp}, got ${JSON.stringify(printed)}`);
  const missing = spawnSync('node', [cli, '--no-store', '--cwd', join(tmp, 'no-such-dir'), '--', 'node', '-e', '1'], { encoding: 'utf8', cwd: root });
  expect(missing.status === 2, `a --cwd naming no directory must exit 2, got ${missing.status}`);
  const bare = spawnSync('node', [cli, '--no-store', '--cwd', '--json', '--', 'node', '-e', '1'], { encoding: 'utf8', cwd: root });
  expect(bare.status === 2, `--cwd with no value must exit 2, got ${bare.status}`);
}

rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\ndigest-hook eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('ok   the switch is off by default: unset, off, 0, false, and an unnamed value print nothing');
console.log(`ok   ${REWRITTEN.length} allowlisted commands rewrite exactly, cd prefix included, tool input preserved`);
console.log(`ok   ${PASSED_THROUGH.length} compound, structured, unlisted, wrapped, and over-long commands pass through`);
console.log('ok   no permissionDecision: the host re-evaluates permissions against updatedInput');
console.log('ok   a pipe is refused twice: one guard removed still holds, both removed wraps');
console.log("ok   digest.mjs --cwd moves the child's working directory and exits 2 on a bad value");
console.log('\ndigest-hook eval passed');
