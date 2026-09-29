#!/usr/bin/env node
// Regression eval for the change feed (scripts/change-feed.mjs, C3 of the program-state design)
// and its three integration points: hooks/handoff-card.mjs, hooks/index-refresh.mjs, and the seal
// in scripts/records.mjs. Every case runs against a fake home (`CODE_OPS_HOME`, `HOME`) and real
// temporary git repositories, so the operator's own feed store is never touched. It pins:
//   - a Bash `git push` appends a push event naming the session, branch, commit, and changed
//     paths, and a `gh pr merge` appends a merge event; a dry run, a failed exit, and an
//     up-to-date push append nothing;
//   - an edit to DOCS_MANIFEST.json or PROGRAM.md appends a hub-edit event through index-refresh,
//     a repeat within five minutes does not, and any other file does not;
//   - a peer gets one line per new event when its branch or its board edits intersect it, and
//     nothing when neither does, including for a peer in a linked worktree of the repository;
//   - a push reads its range, target branch, and commit from the push summary in the tool result
//     (fast-forward, new branch, `a:b` refspec, forced update, rejected, and unreadable output),
//     spawns one `git diff` at most (none when no other live session is on the board), and records
//     nothing when no branch moved;
//   - the read cursor delivers a line once, a session never hears its own events, a session with
//     no cursor reads only the last ten minutes, and a later event still arrives;
//   - the feed line joins the context card's additionalContext without changing its
//     systemMessage; without a card it stands alone; Grok delivers at PostToolUse only;
//   - the feed keeps at most MAX_EVENTS events and MAX_BYTES bytes and drops the oldest first;
//   - a corrupt feed or cursor fails open, and the next append rewrites the file clean;
//   - CODE_OPS_FEED and CODE_OPS_PEER_GUARD turn the feed off, and CODE_OPS_HANDOFF_CARD=off
//     silences the card but not the feed;
//   - a seal-start warns a second seal on the same base head, and a land, an abort, another head,
//     or a stale start clears the warning; the seal command posts start and abort events and
//     prints the warning on stderr without refusing;
//   - no record holds an absolute path.
//
//   node evals/change-feed/run.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cardHook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'handoff-card.mjs');
const editHook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'index-refresh.mjs');
const recordsScript = join(root, 'scripts', 'records.mjs');
const feed = await import(pathToFileURL(join(root, 'scripts', 'change-feed.mjs')).href);
const { updateBoard, boardEdits, repoIdentity } = await import(pathToFileURL(join(root, 'scripts', 'handoff-state.mjs')).href);
const { check, fails } = tally((name, detail) => `${name}: ${String(detail).slice(0, 400)}`);

const tmp = mkdtempSync(join(tmpdir(), 'change-feed-'));
const home = join(tmp, 'home');
mkdirSync(home, { recursive: true });
process.env.CODE_OPS_HOME = home;

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const write = (dir, name, body) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), body); };

// origin.git, plus a working clone on main with one pushed commit and an upstream.
const origin = join(tmp, 'origin.git');
const repo = join(tmp, 'repo');
git(['init', '--bare', '-b', 'main', origin], tmp);
git(['clone', '--quiet', origin, repo], tmp);
git(['checkout', '-B', 'main'], repo);
write(repo, 'README.md', 'seed\n');
git(['add', '-A'], repo);
git(['commit', '-m', 'seed'], repo);
git(['push', '--quiet', '-u', 'origin', 'main'], repo);
git(['remote', 'set-head', 'origin', 'main'], repo);
const key = repoIdentity(repo).key;
const eventsFile = join(home, '.claude', 'code-ops', 'feed', key, 'events.jsonl');
const readFeed = () => (existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function runHook(script, payload, { env = {}, grok = false } = {}) {
  const e = { ...process.env, CODE_OPS_HOME: home, HOME: home, USERPROFILE: home, ...env };
  for (const name of ['CODE_OPS_HANDOFF_CARD', 'CODE_OPS_FEED', 'CODE_OPS_PEER_GUARD', 'GROK_PLUGIN_ROOT', 'CODE_OPS_CONTEXT_CEILING']) if (!(name in env)) delete e[name];
  if (grok) e.GROK_PLUGIN_ROOT = join(root, 'plugins', 'code-ops-suite');
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8', env: e });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { out = 'unparsable'; }
  return { status: r.status, stdout: r.stdout, out };
}
const bash = (sid, command, cwd, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: 'ok', stderr: '' }, ...extra });
const prompt = (sid, cwd, extra = {}) => ({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'continue', ...extra });
const board = (cwd, sid, name, edits = []) => updateBoard(cwd, sid, (rec, ident) => { rec.name = name; boardEdits(edits)(rec, ident); }, home);
const ctx = (r) => r.out?.hookSpecificOutput?.additionalContext ?? '';

board(repo, 'sid-alpha', 'Alpha');
board(repo, 'sid-beta', 'Beta', ['src/a.txt']);

// ------------------------------------------------------------------ push, merge, and dry runs
write(repo, 'src/a.txt', 'one\n');
git(['add', '-A'], repo);
git(['commit', '-m', 'add a'], repo);
git(['push', '--quiet', 'origin', 'main'], repo);
const head = git(['rev-parse', 'HEAD'], repo);

let r = runHook(cardHook, bash('sid-alpha', 'git push origin main', repo, { tool_response: { stdout: 'To origin' } }));
let events = readFeed();
check('a git push appends one push event with session, branch, commit, and changed paths', r.status === 0 && events.length === 1
  && events[0].kind === 'push' && events[0].session === 'Alpha' && events[0].branch === 'main' && events[0].commit === head
  && events[0].paths.join() === 'src/a.txt' && events[0].sid === 'sid-alpha', JSON.stringify(events));
check('the pusher hears nothing of its own event', r.status === 0 && r.stdout === '', r.stdout);
check('the event names the repository key file, holds no absolute path', !readFileSync(eventsFile, 'utf8').includes(tmp.replace(/\\/g, '/')) && !readFileSync(eventsFile, 'utf8').includes(tmp.replace(/\\/g, '\\\\')), '');

const before = readFeed().length;
runHook(cardHook, bash('sid-alpha', 'git push --dry-run origin main', repo));
runHook(cardHook, bash('sid-alpha', 'git push origin main', repo, { tool_response: { stdout: '', stderr: 'Everything up-to-date' } }));
runHook(cardHook, bash('sid-alpha', 'git push origin main', repo, { tool_response: { exit_code: 1, stdout: '' } }));
runHook(cardHook, bash('sid-alpha', 'git status', repo));
runHook(cardHook, { ...bash('sid-alpha', 'git push origin main', repo), tool_name: 'Read' });
check('a dry run, an up-to-date push, a failed push, another command, and another tool append nothing', readFeed().length === before, JSON.stringify(readFeed()));

git(['checkout', '-q', '-b', 'feat/x'], repo);
write(repo, 'docs/b.md', 'two\n');
git(['add', '-A'], repo);
git(['commit', '-m', 'add b'], repo);
runHook(cardHook, bash('sid-alpha', 'gh pr merge 5 --squash', repo));
const merge = readFeed().at(-1);
check('a gh pr merge appends a merge event with the branch diff against the default branch', merge?.kind === 'merge' && merge.branch === 'feat/x'
  && merge.paths.join() === 'docs/b.md' && merge.commit === git(['rev-parse', 'HEAD'], repo), JSON.stringify(merge));
git(['checkout', '-q', 'main'], repo);

// ------------------------------------------------------------------ hub-file edits
const hubPath = join(repo, '98 System', 'DOCS_MANIFEST.json');
const edit = (sid, file) => runHook(editHook, { hook_event_name: 'PostToolUse', session_id: sid, cwd: repo, tool_name: 'Edit', tool_input: { file_path: file } }, { env: { CODE_OPS_INDEX: 'off' } });
edit('sid-alpha', hubPath);
edit('sid-alpha', hubPath);
edit('sid-alpha', join(repo, 'notes', 'PROGRAM.md'));
edit('sid-alpha', join(repo, 'src', 'other.txt'));
const hubs = readFeed().filter((e) => e.kind === 'hub-edit');
check('an edit to DOCS_MANIFEST.json or PROGRAM.md appends a hub-edit event; a repeat and another file do not', hubs.length === 2
  && hubs[0].paths.join() === '98 System/DOCS_MANIFEST.json' && hubs[1].paths.join() === 'notes/PROGRAM.md' && hubs[0].branch === 'main', JSON.stringify(hubs));

// ------------------------------------------------------------------ delivery
// Beta is on main and edited src/a.txt: it hears the push (branch and overlap) and the hub events (branch).
r = runHook(cardHook, prompt('sid-beta', repo));
const lines = ctx(r).split('\n');
check('a peer on the branch gets one line per event, naming the sha, the session, and the files it edited', r.status === 0
  && lines.some((l) => l.includes(`main moved to ${head.slice(0, 7)} by Alpha; it touched files you edited: src/a.txt`))
  && lines.filter((l) => l.startsWith('code-ops change feed:')).length === 3 && !('systemMessage' in r.out) && r.out.hookSpecificOutput.hookEventName === 'UserPromptSubmit', r.stdout);
r = runHook(cardHook, prompt('sid-beta', repo));
check('the cursor delivers a line once', r.status === 0 && r.stdout === '', r.stdout);
r = runHook(cardHook, bash('sid-beta', 'ls', repo));
check('a PostToolUse call after the cursor moved is silent too', r.status === 0 && r.stdout === '', r.stdout);

// Gamma sits in a linked worktree on another branch with unrelated edits; delta shares an edit.
const wt = join(tmp, 'wt');
git(['worktree', 'add', '-q', '-b', 'other', wt], repo);
board(wt, 'sid-gamma', 'Gamma', ['z.txt']);
board(wt, 'sid-delta', 'Delta', ['src/a.txt']);
r = runHook(cardHook, prompt('sid-gamma', wt));
check('a peer in a linked worktree of the repository shares the feed and hears nothing unrelated to its branch and edits', r.status === 0 && r.stdout === '', r.stdout);
r = runHook(cardHook, prompt('sid-delta', wt));
check('a peer on another branch hears an event that touched a file it edited', r.status === 0 && ctx(r).includes('it touched files you edited: src/a.txt'), r.stdout);
check('the worktree session and the main checkout share one feed key', repoIdentity(wt).key === key, `${repoIdentity(wt).key} vs ${key}`);

// A new event reaches an initialized cursor once.
write(repo, 'src/c.txt', 'three\n');
git(['add', '-A'], repo);
git(['commit', '-m', 'add c'], repo);
git(['push', '--quiet', 'origin', 'main'], repo);
runHook(cardHook, bash('sid-alpha', 'git status && git push', repo));
r = runHook(cardHook, prompt('sid-beta', repo));
check('a later event is delivered to an initialized cursor', r.status === 0 && ctx(r).split('\n').length === 1 && ctx(r).includes('main moved to'), r.stdout);
r = runHook(cardHook, prompt('sid-beta', repo));
check('and only once', r.status === 0 && r.stdout === '', r.stdout);

// A session with no cursor reads ten minutes back, not older history.
const oldFile = readFeed();
writeFileSync(eventsFile, `${oldFile.map((e) => JSON.stringify({ ...e, at: new Date(Date.now() - 3 * 3600_000).toISOString() })).join('\n')}\n`);
board(repo, 'sid-late', 'Late', ['src/a.txt']);
r = runHook(cardHook, prompt('sid-late', repo));
check('a session with no cursor skips events older than ten minutes', r.status === 0 && r.stdout === '', r.stdout);

// ------------------------------------------------------------------ the card and the feed together
const transcript = join(tmp, 'transcript.jsonl');
writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { id: 'm', model: 'claude-test', usage: { input_tokens: 1000, cache_read_input_tokens: 160_000, cache_creation_input_tokens: 0, output_tokens: 5 } } })}\n`);
board(repo, 'sid-card', 'Card', ['src/a.txt']);
board(repo, 'sid-card2', 'Card2', ['src/a.txt']);
const baseline = runHook(cardHook, prompt('sid-card', repo, { transcript_path: transcript }));
await feed.postEvent(repo, { kind: 'push', sid: 'sid-alpha', commit: head, paths: ['src/a.txt'] }, home);
const merged = runHook(cardHook, prompt('sid-card2', repo, { transcript_path: transcript }));
check('the feed line joins the card without changing its systemMessage', baseline.out?.systemMessage && merged.out?.systemMessage === baseline.out.systemMessage
  && merged.out.hookSpecificOutput.additionalContext === `${baseline.out.systemMessage}\ncode-ops change feed: main moved to ${head.slice(0, 7)} by Alpha; it touched files you edited: src/a.txt.`, merged.stdout);

const off = runHook(cardHook, prompt('sid-card2', repo, { transcript_path: transcript }), { env: { CODE_OPS_HANDOFF_CARD: 'off' } });
check('CODE_OPS_HANDOFF_CARD=off silences the card and leaves the feed on', off.status === 0, off.stdout);
await feed.postEvent(repo, { kind: 'push', sid: 'sid-alpha', commit: head, paths: ['src/a.txt'] }, home);
const cardOff = runHook(cardHook, prompt('sid-card', repo, { transcript_path: transcript }), { env: { CODE_OPS_HANDOFF_CARD: 'off' } });
check('with the card off the feed line still arrives, alone', cardOff.out?.systemMessage === undefined && ctx(cardOff).startsWith('code-ops change feed:'), cardOff.stdout);

// Grok delivers at PostToolUse only.
await feed.postEvent(repo, { kind: 'push', sid: 'sid-alpha', commit: head, paths: ['src/a.txt'] }, home);
r = runHook(cardHook, { ...prompt('sid-beta', repo) }, { grok: true });
check('Grok UserPromptSubmit stays silent', r.status === 0 && r.stdout === '', r.stdout);
r = runHook(cardHook, bash('sid-beta', 'ls', repo), { grok: true });
check('Grok PostToolUse carries the feed line as PostToolUse additionalContext', r.status === 0 && r.out?.hookSpecificOutput?.hookEventName === 'PostToolUse'
  && !('systemMessage' in r.out) && ctx(r).includes('code-ops change feed:'), r.stdout);

// ------------------------------------------------------------------ off switches
const offRepo = readFeed().length;
for (const env of [{ CODE_OPS_FEED: 'off' }, { CODE_OPS_PEER_GUARD: '0' }, { CODE_OPS_FEED: 'false' }]) {
  const push = runHook(cardHook, bash('sid-alpha', 'git push origin main', repo), { env });
  const hear = runHook(cardHook, prompt('sid-beta', repo), { env });
  const hub = edit2(env);
  check(`${Object.keys(env)[0]}=${Object.values(env)[0]} stops posting and delivery`, push.status === 0 && push.stdout === '' && hear.stdout === '' && readFeed().length === offRepo && hub, `${push.stdout}${hear.stdout}`);
}
function edit2(env) {
  runHook(editHook, { hook_event_name: 'PostToolUse', session_id: 'sid-alpha', cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, 'x', 'PROGRAM.md') } }, { env: { CODE_OPS_INDEX: 'off', ...env } });
  return readFeed().length === offRepo;
}

// ------------------------------------------------------------------ push summary parsing and spawn cost
// The push summary in the tool result names the range, the branch, and the commit, so a push spawns
// one `git diff` at most. `run` counts every git call `gitFacts` makes.
{
  const spawns = [];
  const counting = (cmd, args, opts) => { spawns.push(args.join(' ')); return spawnSync(cmd, args, opts); };
  const facts = (kind, output, cwd = repo) => { spawns.length = 0; return feed.gitFacts(cwd, kind, { output, ident: repoIdentity(cwd), run: counting }); };
  const sha = (ref, cwd = repo) => git(['rev-parse', ref], cwd);
  const short = (ref) => git(['rev-parse', '--short', ref], repo);
  const summary = (...lines) => `To origin\n${lines.join('\n')}\n`;
  const mainHead = sha('HEAD');
  const range = `${short('HEAD~1')}..${short('HEAD')}`;

  let f = facts('push', summary(`   ${range}  main -> main`));
  check('a fast-forward summary gives the branch, the full commit, and the range paths from one git call',
    f.moved && f.branch === 'main' && f.commit === mainHead && f.paths.join() === 'src/c.txt' && spawns.length === 1 && spawns[0].startsWith('diff --name-only'), JSON.stringify({ f, spawns }));
  f = facts('push', summary(`   ${range}  HEAD -> release`));
  check('a HEAD:release refspec records the target ref, not the current branch', f.moved && f.branch === 'release' && f.commit === mainHead && f.paths.join() === 'src/c.txt' && spawns.length === 1, JSON.stringify({ f, spawns }));
  f = facts('push', summary(`   ${range}  main -> refs/heads/staging`));
  check('a target written as refs/heads/<name> records the short name', f.branch === 'staging' && f.commit === mainHead, JSON.stringify(f));

  git(['checkout', '-q', '-b', 'topic'], repo);
  write(repo, 'topic.txt', 'topic\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'topic'], repo);
  git(['checkout', '-q', '-b', 'fb', 'main'], repo);
  write(repo, 'fb.txt', 'fb\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'fb'], repo);
  git(['checkout', '-q', 'main'], repo);
  const topic = sha('topic');
  f = facts('push', summary(' * [new branch]      topic -> topic'));
  check('a new branch reads its tip from the ref files and diffs it against the default branch with one git call',
    f.moved && f.branch === 'topic' && f.commit === topic && f.paths.join() === 'topic.txt' && spawns.length === 1 && spawns[0] === 'diff --name-only origin/main...' + topic, JSON.stringify({ f, spawns }));
  f = facts('push', summary(`+ ${short('topic')}...${short('fb')}  fb -> topic (forced update)`));
  check('a forced update diffs the merge base of the old and new tips, and names the target branch', f.moved && f.branch === 'topic' && f.commit === sha('fb') && f.paths.join() === 'fb.txt' && spawns.length === 1, JSON.stringify({ f, spawns }));

  f = facts('push', summary('! [rejected]        main -> main (non-fast-forward)', '= [up to date]      dev -> dev', ' - [deleted]         old', ' * [new tag]         v1 -> v1'));
  check('a summary with no branch move (rejected, up to date, deleted, tag) is no event and runs no git', f.moved === false && spawns.length === 0, JSON.stringify({ f, spawns }));
  f = facts('push', summary('! [rejected]        main -> main (non-fast-forward)', `   ${range}  main -> main`));
  check('an accepted ref beside a rejected one still counts', f.moved && f.branch === 'main', JSON.stringify(f));
  f = facts('push', summary('   1111111..2222222  main -> main'));
  check('a range git cannot diff keeps the event with the printed commit and the branch, and no paths', f.moved && f.branch === 'main' && f.commit === '2222222' && f.paths.length === 0 && spawns.length === 1, JSON.stringify({ f, spawns }));
  f = facts('push', 'To origin\nnothing recognizable here');
  check('output with no ref line falls back to asking git, still with the commit and the changed paths', f.moved && f.commit === mainHead && f.paths.length > 0 && spawns.length >= 1 && spawns.length <= 3, JSON.stringify({ f, spawns }));
  f = facts('push', '');
  check('an empty tool result falls back too', f.moved && f.commit === mainHead && f.paths.length > 0, JSON.stringify(f));
  f = facts('merge', '');
  check('a merge reads the commit and the default branch from the ref files and spawns one diff', f.moved && f.commit === mainHead && spawns.length === 1 && spawns[0] === 'diff --name-only origin/main...HEAD', JSON.stringify({ f, spawns }));

  f = facts('push', summary(' * [new branch]      other -> other'), wt);
  check('a linked worktree reads refs and the default branch through its common folder, with one git call', f.moved && f.branch === 'other' && f.commit === sha('other', wt) && spawns.length === 1 && spawns[0].startsWith('diff'), JSON.stringify({ f, spawns }));
  git(['pack-refs', '--all'], repo);
  f = facts('push', summary(' * [new branch]      topic -> topic'));
  check('packed refs give the same tip', f.commit === topic && f.paths.join() === 'topic.txt' && spawns.length === 1, JSON.stringify({ f, spawns }));
  f = facts('push', summary(` * [new branch]      ${'../'.repeat(3)}x -> y`));
  check('a source ref that climbs out of the ref folder is not read', f.moved === false || f.commit === null, JSON.stringify(f));

  // No other live session: the quiet path spawns no git and keeps the commit and branch.
  const quiet = (kind, output) => { spawns.length = 0; return feed.gitFacts(repo, kind, { output, ident: repoIdentity(repo), run: counting, diff: false }); };
  f = quiet('push', summary(`   ${range}  main -> main`));
  check('diff:false on a readable summary spawns no git and keeps the branch and commit', f.moved && f.branch === 'main' && f.commit === mainHead && f.paths.length === 0 && spawns.length === 0, JSON.stringify({ f, spawns }));
  f = quiet('push', 'no summary');
  check('diff:false on an unreadable summary and on a merge spawns no git either', f.commit === mainHead && f.paths.length === 0 && spawns.length === 0
    && quiet('merge', '').commit === mainHead && spawns.length === 0, JSON.stringify({ f, spawns }));
  const solo = mkdtempSync(join(tmpdir(), 'change-feed-solo-'));
  git(['init', '-q', '-b', 'main', solo], tmp);
  write(solo, 'a.txt', 'a\n');
  git(['add', '-A'], solo);
  git(['commit', '-q', '-m', 'a'], solo);
  write(solo, 'b.txt', 'b\n');
  git(['add', '-A'], solo);
  git(['commit', '-q', '-m', 'b'], solo);
  board(solo, 'sid-solo', 'Solo');
  const soloFile = join(home, '.claude', 'code-ops', 'feed', repoIdentity(solo).key, 'events.jsonl');
  runHook(cardHook, bash('sid-solo', 'git push origin main', solo, { tool_response: { stdout: '', stderr: summary(`   ${git(['rev-parse', '--short', 'HEAD~1'], solo)}..${git(['rev-parse', '--short', 'HEAD'], solo)}  main -> main`), exit_code: 0 } }));
  const alone = existsSync(soloFile) ? readFileSync(soloFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  check('a push by the only live session posts its commit and branch with no paths', alone.length === 1 && alone[0].branch === 'main'
    && alone[0].commit === git(['rev-parse', 'HEAD'], solo) && alone[0].paths.length === 0, JSON.stringify(alone));
  board(solo, 'sid-peer', 'Peer');
  runHook(cardHook, bash('sid-solo', 'git push origin main', solo, { tool_response: { stdout: '', stderr: summary(`   ${git(['rev-parse', '--short', 'HEAD~1'], solo)}..${git(['rev-parse', '--short', 'HEAD'], solo)}  main -> main`), exit_code: 0 } }));
  check('with another live session the same push names the changed paths', readFileSync(soloFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).at(-1)?.paths.join() === 'b.txt', readFileSync(soloFile, 'utf8').slice(-300));
  rmSync(solo, { recursive: true, force: true });

  // Through the hook: the summary picks the target branch, and a rejected push posts nothing.
  const count = readFeed().length;
  runHook(cardHook, bash('sid-alpha', 'git push origin HEAD:release', repo, { tool_response: { stdout: '', stderr: summary(`   ${range}  HEAD -> release`), exit_code: 0 } }));
  const posted = readFeed();
  check('the hook posts the push under the target branch with the summary paths', posted.length === count + 1 && posted.at(-1).branch === 'release'
    && posted.at(-1).commit === mainHead && posted.at(-1).paths.join() === 'src/c.txt', JSON.stringify(posted.at(-1)));
  runHook(cardHook, bash('sid-alpha', 'git push origin main', repo, { tool_response: { stdout: '', stderr: summary('! [rejected]        main -> main (non-fast-forward)'), exit_code: 0 } }));
  check('the hook posts nothing for a summary that shows no branch move', readFeed().length === count + 1, String(readFeed().length));
}

// ------------------------------------------------------------------ bounds and corruption
{
  const bounded = mkdtempSync(join(tmpdir(), 'change-feed-bound-'));
  git(['init', '-q', '-b', 'main', bounded], tmp);
  const boundedKey = repoIdentity(bounded).key;
  const file = join(home, '.claude', 'code-ops', 'feed', boundedKey, 'events.jsonl');
  for (let i = 0; i < feed.MAX_EVENTS + 40; i++) await feed.postEvent(bounded, { kind: 'push', sid: 'sid-b', commit: head, paths: [`f${i}.txt`] }, home);
  let kept = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  check('the feed keeps at most MAX_EVENTS events and drops the oldest', kept.length === feed.MAX_EVENTS
    && kept.at(-1).paths[0] === `f${feed.MAX_EVENTS + 39}.txt` && kept[0].paths[0] === 'f40.txt', `${kept.length} ${kept[0]?.paths}`);
  const wide = Array.from({ length: 20 }, (_, i) => `${'d'.repeat(180)}${i}.txt`);
  for (let i = 0; i < 30; i++) await feed.postEvent(bounded, { kind: 'push', sid: 'sid-b', commit: head, paths: wide }, home);
  const size = Buffer.byteLength(readFileSync(file, 'utf8'));
  kept = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  check('the feed keeps at most MAX_BYTES bytes, newest last', size <= feed.MAX_BYTES && kept.length >= 1 && kept.length < 30 && kept.at(-1).paths.length === 20, `${size} bytes, ${kept.length} events`);

  // Corrupt lines, a binary tail, and a corrupt cursor fail open; the next append rewrites clean.
  const valid = JSON.stringify(kept.at(-1));
  writeFileSync(file, Buffer.concat([Buffer.from(`not json\n{"kind":"push"}\n[1,2]\n${valid}\n`), Buffer.from([0, 255, 254, 10, 123, 34])]));
  board(bounded, 'sid-peer', 'Peer', ['x']);
  const cursorDir = join(home, '.claude', 'code-ops', 'feed', boundedKey, 'cursors');
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, 'sid-peer.json'), '{{{ corrupt');
  const got = await feed.deliver(bounded, 'sid-peer', home);
  check('corrupt lines and a corrupt cursor are skipped, and the valid event still delivers', got.length === 1 && got[0].startsWith('code-ops change feed:'), JSON.stringify(got));
  await feed.postEvent(bounded, { kind: 'push', sid: 'sid-b', commit: head, paths: ['after.txt'] }, home);
  const clean = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  check('the next append rewrites the file without the corrupt lines', clean.length === 2 && clean.every((l) => { try { return JSON.parse(l).kind === 'push'; } catch { return false; } }), String(clean.length));
  writeFileSync(file, Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7) % 256)));
  const hook = runHook(cardHook, prompt('sid-peer', bounded));
  check('a wholly corrupt feed exits 0 with no output', hook.status === 0 && hook.stdout === '', hook.stdout);
  rmSync(bounded, { recursive: true, force: true });
}

// ------------------------------------------------------------------ seals
{
  const sealRepo = mkdtempSync(join(tmpdir(), 'change-feed-seal-'));
  git(['init', '-q', '-b', 'main', sealRepo], tmp);
  const base = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  const first = await feed.startSeal(sealRepo, { base, note: 'evidence' }, home);
  const second = await feed.startSeal(sealRepo, { base, note: 'evidence' }, home);
  check('a seal starting on the same base head as an in-flight seal gets a warning; the first gets none', first.warnings.length === 0
    && second.warnings.length === 1 && second.warnings[0].includes('has not landed it') && second.warnings[0].includes(base.slice(0, 7)), JSON.stringify(second));
  check('a seal on another base head gets none', (await feed.startSeal(sealRepo, { base: other }, home)).warnings.length === 0, '');
  await feed.endSeal(sealRepo, { seal: first.seal, land: true, base, paths: ['records/d2.md'] }, home);
  check('after the first seal lands, the second is the only one in flight', (await feed.startSeal(sealRepo, { base }, home)).warnings.length === 1, '');
  await feed.endSeal(sealRepo, { seal: second.seal, land: false, base }, home);
  const lastKey = repoIdentity(sealRepo).key;
  const sealEvents = readFileSync(join(home, '.claude', 'code-ops', 'feed', lastKey, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  check('seal events carry the start, land, and abort kinds with one seal id per seal', sealEvents.filter((e) => e.kind === 'seal-start').length === 4
    && sealEvents.some((e) => e.kind === 'seal-land' && e.seal === first.seal && e.paths[0] === 'records/d2.md')
    && sealEvents.some((e) => e.kind === 'seal-abort' && e.seal === second.seal), JSON.stringify(sealEvents.map((e) => e.kind)));
  const stale = mkdtempSync(join(tmpdir(), 'change-feed-stale-'));
  git(['init', '-q', '-b', 'main', stale], tmp);
  const staleFile = join(home, '.claude', 'code-ops', 'feed', repoIdentity(stale).key, 'events.jsonl');
  mkdirSync(dirname(staleFile), { recursive: true });
  writeFileSync(staleFile, `${JSON.stringify({ v: 1, id: 'old', at: new Date(Date.now() - 2 * 3600_000).toISOString(), kind: 'seal-start', branch: 'main', commit: base, session: 'Old', sid: 'sid-old', paths: [], seal: 'old-seal' })}\n`);
  check('a seal that started two hours ago and never ended no longer warns', (await feed.startSeal(stale, { base }, home)).warnings.length === 0, '');

  // The seal command: a minimal v3 manifest reaches the feed, then aborts on a missing inventory.
  const cli = mkdtempSync(join(tmpdir(), 'change-feed-cli-'));
  git(['init', '-q', '-b', 'main', cli], tmp);
  write(cli, 'hub/Standard.md', '---\nstandard-version: 5\n---\n# Standard\n');
  write(cli, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify({
    version: 3, hub: 'hub', runs: { tracking: 'ignored', retain: 5 }, domains: [{ id: 'records' }], legacyPaths: [],
    recordCollections: [{ collectionUuid: '22222222-2222-4222-8222-222222222222', id: 'evidence', identityVersion: 1, root: 'records', inventory: '98 System/Records/inventory.json', citations: '98 System/Records/citations.json', curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md', scopes: [{ pattern: '*.md', kind: 'record', policy: 'append-only' }] }],
  }, null, 2)}\n`);
  write(cli, 'records/one.md', '# one\n');
  git(['add', '-A'], cli);
  git(['commit', '-q', '-m', 'seed'], cli);
  const cliHead = git(['rev-parse', 'HEAD'], cli);
  const cliFile = join(home, '.claude', 'code-ops', 'feed', repoIdentity(cli).key, 'events.jsonl');
  const seal = () => spawnSync(process.execPath, [recordsScript, 'seal', '--root', cli, '--collection', 'evidence', '--base', 'main'], { cwd: cli, encoding: 'utf8', env: { ...process.env, CODE_OPS_HOME: home } });
  await feed.startSeal(cli, { base: cliHead, note: 'evidence' }, home);
  const run = seal();
  const cliEvents = existsSync(cliFile) ? readFileSync(cliFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  check('the seal command warns on stderr about an in-flight seal, keeps going, and posts a start and an abort', run.status !== 0 && run.stderr.includes('records: warning:') && run.stderr.includes('has not landed it')
    && cliEvents.filter((e) => e.kind === 'seal-start').length === 2 && cliEvents.filter((e) => e.kind === 'seal-abort').length === 1 && !run.stderr.includes('seal refused: another'), `${run.status} ${run.stderr.slice(0, 300)}`);
  const quiet = spawnSync(process.execPath, [recordsScript, 'seal', '--root', cli, '--collection', 'evidence', '--base', 'main'], { cwd: cli, encoding: 'utf8', env: { ...process.env, CODE_OPS_HOME: home, CODE_OPS_FEED: 'off' } });
  check('CODE_OPS_FEED=off leaves the seal without a warning and without events', !quiet.stderr.includes('records: warning:')
    && (readFileSync(cliFile, 'utf8').split('\n').filter(Boolean).length === cliEvents.length), quiet.stderr.slice(0, 300));
  for (const dir of [sealRepo, stale, cli]) rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------ no absolute paths anywhere in the store
{
  const seen = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else seen.push(readFileSync(p, 'utf8')); } };
  walk(join(home, '.claude', 'code-ops', 'feed'));
  check('no feed or cursor file holds an absolute path', seen.length > 0 && !seen.some((t) => t.includes(tmp) || /"[A-Za-z]:[\\/]/.test(t)), `${seen.length} files`);
}

rmSync(tmp, { recursive: true, force: true });
if (fails.length) {
  console.error(`\nchange-feed eval failed:\n${fails.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nchange-feed eval passed');
