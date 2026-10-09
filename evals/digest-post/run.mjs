#!/usr/bin/env node
// Post-output digest regression eval — pins digestToolResponse in scripts/digest-lib.mjs, the pure
// core of the PostToolUse digest, against sanitized fixtures under evals/digest-post/fixtures.
//
// The claim under test is that a replacement is rare, shape-exact, and never a loss:
//   - a Bash result over the threshold comes back with every key of the input preserved and only
//     stdout and stderr replaced, the raw bytes land in the store, and each sed hint names the
//     real lines of that file; compound-command output (no command family) compresses too;
//   - null comes back for a result under the threshold, one that already ends with the digest
//     trailer, an interrupted or image result, another tool, and every off switch;
//   - the lead threshold is 4000 characters and the subagent threshold 8000, each overridable;
//   - CODE_OPS_DIGEST_STORE=off still compresses, writes nothing, and says so in the trailer;
//   - Read stays untouched by default; with CODE_OPS_DIGEST_READ on it keeps the exact
//     tool_response shape and swaps only file.content for head, an elision line naming the
//     store file, and tail;
//   - CODE_OPS_DIGEST_READ=lead digests Read on the lead thread only (a subagent and a ranged Read
//     arrive whole); a digested Read marks its path for its thread, and writeDenial refuses a full
//     Write of a marked path, naming the elided range, until a later Read of that path arrives
//     whole; it is inert with the switch off, scoped to one session, thread, and path, and fails open;
//   - the PostToolUse hook (plugins/code-ops-suite/hooks/digest-post.mjs) prints the replacement
//     envelope over the threshold, and prints nothing below it, when switched off, for any tool
//     but Bash and Read, and on malformed stdin, always exiting 0;
//   - mutation controls: a copy of the library without the trailer skip, and one with the two
//     thresholds swapped, must each fail this same case list, and a hook that prints on error or
//     drops agent_id must fail the hook cases, and seven edits to the Read marks (lead mode that digests
//     a subagent, a ranged Read that stays digested, a mark shared across threads, a mark that never
//     clears, marks armed in on mode, a deny armed in on mode, a clear row appended with no live mark) must each fail the lib cases, so the cases are proven able to fail.
//
//   node evals/digest-post/run.mjs   (exit 0 = pass)

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const libPath = join(root, 'scripts', 'digest-lib.mjs');
const pluginDir = join(root, 'plugins', 'code-ops-suite');
const hookPath = join(pluginDir, 'hooks', 'digest-post.mjs');
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
const NOW = new Date('2026-10-08T12:00:00.000Z');
const BASH_KEYS = ['stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected'];
const READ_KEYS = ['type', 'file'];
const READ_FILE_KEYS = ['filePath', 'content', 'numLines', 'startLine', 'totalLines'];
const keys = (o) => Object.keys(o).join(',');

// Runs every case against one copy of the library and returns the failed case names.
async function runCases(lib, scratch, quiet) {
  const { fails, check } = tally((name, detail) => (detail ? `${name}: ${detail}` : name));
  const ok = quiet ? (name, cond, detail) => { if (!cond) fails.push(detail ? `${name}: ${detail}` : name); } : check;
  let n = 0;
  const store = () => join(scratch, `store-${n++}`);
  const run = (tool, resp, ctx = {}, env = {}) => lib.digestToolResponse(tool, structuredClone(resp), { store: store(), now: NOW, env, ...ctx });

  const compound = fixture('bash-compound');
  const tests = fixture('bash-tests');
  const longline = fixture('bash-longline');

  // round trip: shape, store, hints, receipt
  const dir = store();
  const r = lib.digestToolResponse('Bash', structuredClone(compound), { store: dir, now: NOW, env: {} });
  ok('bash: a compound-command result over the lead threshold is replaced', r !== null);
  ok('bash: every key of the input survives, in order', r !== null && keys(r) === keys(compound) && keys(r) === BASH_KEYS.join(','), r ? keys(r) : '');
  ok('bash: the flags are carried over unchanged', r !== null && r.interrupted === false && r.isImage === false && r.noOutputExpected === false);
  ok('bash: stdout shrinks and keeps the error line and the final line', r !== null && r.stdout.length < compound.stdout.length / 2
    && r.stdout.includes('error: record-061 checksum mismatch') && r.stdout.includes('all done'));
  const trailer = r?.stdout.trimEnd().split('\n').at(-1) ?? '';
  const rawPath = /raw (.+?) · sha256:/.exec(trailer)?.[1] ?? '';
  ok('bash: the trailer names the raw file, and the file holds the whole stdout', rawPath !== '' && existsSync(rawPath) && readFileSync(rawPath, 'utf8') === compound.stdout, trailer);
  const hint = /elided (\d+) lines: sed -n '(\d+),(\d+)p' (.+?)\]/.exec(r?.stdout ?? '');
  const rawLines = existsSync(rawPath) ? readFileSync(rawPath, 'utf8').split('\n') : [];
  ok('bash: the sed hint names a real range of the stored file', hint !== null && Number(hint[3]) - Number(hint[2]) + 1 === Number(hint[1]) && hint[4] === rawPath && rawLines.length > Number(hint[3]), hint?.[0]);
  const rows = existsSync(join(dir, 'DIGEST_RECEIPTS.jsonl')) ? readFileSync(join(dir, 'DIGEST_RECEIPTS.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  ok('bash: one receipt row records the post digest', rows.length === 1 && rows[0].source === 'post' && rows[0].raw === rawPath && rows[0].bytesIn === compound.stdout.length, JSON.stringify(rows));

  // stderr rides in its own key, and the stored file holds both streams
  const dirT = store();
  const t = lib.digestToolResponse('Bash', structuredClone(tests), { store: dirT, now: NOW, env: {} });
  ok('bash: stderr stays in the stderr key and keeps its error line', t !== null && t.stderr.includes('error: 1 test failed') && !t.stdout.includes('deprecated'));
  ok('bash: the failing test survives', t !== null && t.stdout.includes('not ok 91 - case 91 rejects the sample input'));
  const rawT = /raw (.+?) · sha256:/.exec(t?.stdout ?? '')?.[1] ?? '';
  const bodyT = existsSync(rawT) ? readFileSync(rawT, 'utf8') : '';
  ok('bash: the stored body joins stdout and stderr at a separator', bodyT === `${tests.stdout}----- stderr -----\n${tests.stderr}`);

  // long single line still shrinks
  const l = run('Bash', longline);
  ok('bash: one very long line is cut and still shrinks', l !== null && l.stdout.length < longline.stdout.length / 4);

  // null cases
  ok('null: a result under the threshold', run('Bash', fixture('bash-small')) === null);
  ok('null: an output that already ends with the digest trailer', run('Bash', fixture('bash-digested')) === null);
  ok('null: an interrupted result', run('Bash', { ...compound, interrupted: true }) === null);
  ok('null: an image result', run('Bash', { ...compound, isImage: true }) === null);
  ok('null: a result with a persisted output path', run('Bash', { ...compound, persistedOutputPath: '/x' }) === null);
  ok('null: another tool', run('Grep', compound) === null);
  ok('null: a non-object response', run('Bash', 'text') === null && run('Bash', null) === null);
  ok('null: non-string streams', run('Bash', { ...compound, stdout: 5 }) === null);
  for (const v of ['off', '0', 'false', 'OFF']) {
    ok(`null: CODE_OPS_DIGEST=${v}`, run('Bash', compound, {}, { CODE_OPS_DIGEST: v }) === null);
    ok(`null: CODE_OPS_DIGEST_POST=${v}`, run('Bash', compound, {}, { CODE_OPS_DIGEST_POST: v }) === null);
  }
  ok('on: a value the switches do not name keeps the digest on', run('Bash', compound, {}, { CODE_OPS_DIGEST: 'on', CODE_OPS_DIGEST_POST: '1' }) !== null);

  // thresholds: lead 4000, subagent 8000, both overridable
  const size = compound.stdout.length + compound.stderr.length;
  ok('threshold: the fixture sits between the lead and subagent defaults', size >= 4000 && size < 8000, String(size));
  ok('threshold: the lead thread digests it', run('Bash', compound) !== null);
  ok('threshold: a subagent thread leaves it alone', run('Bash', compound, { agentId: 'a1' }) === null);
  ok('threshold: a subagent over 8000 characters digests', run('Bash', { ...compound, stdout: compound.stdout + compound.stdout }, { agentId: 'a1' }) !== null);
  ok('threshold: CODE_OPS_DIGEST_POST_SUBAGENT lowers the subagent bar', run('Bash', compound, { agentId: 'a1' }, { CODE_OPS_DIGEST_POST_SUBAGENT: '1000' }) !== null);
  ok('threshold: CODE_OPS_DIGEST_POST_LEAD raises the lead bar', run('Bash', compound, {}, { CODE_OPS_DIGEST_POST_LEAD: '100000' }) === null);
  ok('threshold: the lead override does not move the subagent bar', run('Bash', compound, { agentId: 'a1' }, { CODE_OPS_DIGEST_POST_LEAD: '1' }) === null);
  ok('threshold: a junk override falls back to the default', run('Bash', compound, {}, { CODE_OPS_DIGEST_POST_LEAD: 'x' }) !== null);

  // store off: compress, write nothing, say so
  const dirOff = store();
  const o = lib.digestToolResponse('Bash', structuredClone(compound), { store: dirOff, now: NOW, env: { CODE_OPS_DIGEST_STORE: 'off' } });
  ok('store off: the output still compresses', o !== null && o.stdout.length < compound.stdout.length / 2);
  ok('store off: nothing is written', !existsSync(dirOff) || readdirSync(dirOff).length === 0);
  ok('store off: the trailer says the raw output is not kept', o !== null && /raw - \(store off/.test(o.stdout) && !/sed -n/.test(o.stdout));

  // Read
  const read = fixture('read-text');
  ok('read: the fixture carries the pinned key names', keys(read) === READ_KEYS.join(',') && keys(read.file) === READ_FILE_KEYS.join(','));
  ok('read: off by default', run('Read', read) === null);
  ok('read: off for a value the switch does not name', run('Read', read, {}, { CODE_OPS_DIGEST_READ: 'off' }) === null);
  const readEnv = { CODE_OPS_DIGEST_READ: '1' };
  const dirR = store();
  const rr = lib.digestToolResponse('Read', structuredClone(read), { store: dirR, now: NOW, env: readEnv });
  ok('read: on, a long file is replaced', rr !== null);
  ok('read: the top-level and file keys keep their names and order', rr !== null && keys(rr) === keys(read) && keys(rr.file) === keys(read.file));
  ok('read: every value but content is unchanged', rr !== null && rr.type === read.type && READ_FILE_KEYS.filter((k) => k !== 'content').every((k) => rr.file[k] === read.file[k]));
  ok('read: content stays a string and shrinks', rr !== null && typeof rr.file.content === 'string' && rr.file.content.length < read.file.content.length / 2);
  const srcLines = read.file.content.split('\n');
  const outLines = rr?.file.content.split('\n') ?? [];
  ok('read: head and tail are kept verbatim', outLines.slice(0, 40).join('\n') === srcLines.slice(0, 40).join('\n') && outLines.slice(-40).join('\n') === srcLines.slice(-40).join('\n'));
  const rHint = /^\[elided (\d+) lines: sed -n '(\d+),(\d+)p' (.+)\]$/.exec(outLines[40] ?? '');
  const rawRead = rHint ? rHint[4] : '';
  ok('read: one elision line names the store file and a real range', rHint !== null && existsSync(rawRead) && readFileSync(rawRead, 'utf8') === read.file.content
    && readFileSync(rawRead, 'utf8').split('\n').slice(Number(rHint[2]) - 1, Number(rHint[3])).length === Number(rHint[1]));
  const rOff = lib.digestToolResponse('Read', structuredClone(read), { store: store(), now: NOW, env: { ...readEnv, CODE_OPS_DIGEST_STORE: 'off' } });
  ok('read: store off still elides, without a path', rOff !== null && /^\[elided \d+ lines, not stored/m.test(rOff.file.content));
  ok('read: an already elided result is left alone', run('Read', { ...read, file: { ...read.file, content: rr?.file.content ?? '' } }, {}, { ...readEnv, CODE_OPS_DIGEST_POST_LEAD: '0' }) === null);
  ok('read: a short file is left alone', run('Read', { ...read, file: { ...read.file, content: 'a\nb\n' } }, {}, readEnv) === null);
  ok('read: a result without file content is left alone', run('Read', { type: 'file_unchanged', file: { filePath: '/x' } }, {}, readEnv) === null);

  // Read, lead mode and the Write guard
  const leadEnv = { CODE_OPS_DIGEST_READ: 'lead' };
  const total = read.file.content.split('\n').length;
  ok('lead: the lead thread is digested', run('Read', read, {}, leadEnv) !== null);
  ok('lead: the value is case-insensitive', run('Read', read, {}, { CODE_OPS_DIGEST_READ: 'LEAD' }) !== null);
  ok('lead: a subagent Read arrives whole', run('Read', read, { agentId: 'a1' }, { ...leadEnv, CODE_OPS_DIGEST_POST_SUBAGENT: '0' }) === null);
  ok('on: a subagent Read is still digested', run('Read', read, { agentId: 'a1' }, { ...readEnv, CODE_OPS_DIGEST_POST_SUBAGENT: '0' }) !== null);
  ok('lead: a ranged Read arrives whole', run('Read', read, { ranged: true }, leadEnv) === null);
  ok('on: a ranged Read is digested as before', run('Read', read, { ranged: true }, readEnv) !== null);
  const wctx = { sessionId: 's1', filePath: '/x/a.txt', cwd: '/x', store: store(), now: NOW, env: leadEnv };
  const mark = (extra = {}, env = leadEnv) => lib.digestToolResponse('Read', structuredClone(read), { ...wctx, env, ...extra });
  ok('guard: nothing is refused before any Read', lib.writeDenial(wctx) === null);
  ok('guard: a digested lead Read is marked', mark() !== null);
  const denial = lib.writeDenial(wctx) ?? '';
  ok('guard: a full Write of the marked path is refused, naming the elided range and the offset', denial.includes(`lines 41-${total - 40}`) && denial.includes('offset 41') && denial.includes(`limit ${total - 80}`), denial);
  ok('guard: the refusal names the raw copy', /raw copy at .*.txt/.test(denial), denial);
  ok('guard: a relative form of the same path is refused too', lib.writeDenial({ ...wctx, filePath: 'a.txt' }) !== null);
  ok('guard: a path never digested is allowed', lib.writeDenial({ ...wctx, filePath: '/x/b.txt' }) === null);
  ok('guard: another thread is allowed', lib.writeDenial({ ...wctx, agentId: 'a2' }) === null);
  ok('guard: another session is allowed', lib.writeDenial({ ...wctx, sessionId: 's2' }) === null);
  ok('guard: inert with the Read switch off', lib.writeDenial({ ...wctx, env: {} }) === null && lib.writeDenial({ ...wctx, env: { CODE_OPS_DIGEST_READ: 'off' } }) === null);
  ok('guard: inert with the whole digest off', lib.writeDenial({ ...wctx, env: { ...leadEnv, CODE_OPS_DIGEST: 'off' } }) === null);
  ok('guard: a ranged Read clears the mark', mark({ ranged: true }) === null && lib.writeDenial(wctx) === null);
  mark();
  ok('guard: the mark returns after another digested Read', lib.writeDenial(wctx) !== null);
  ok('guard: a short whole Read clears the mark', lib.digestToolResponse('Read', { ...structuredClone(read), file: { ...read.file, content: 'a\nb\n' } }, wctx) === null && lib.writeDenial(wctx) === null);
  mark();
  mark({ agentId: 'a2' }, { ...leadEnv });
  ok('guard: a subagent Read under lead mode leaves the lead mark alone', lib.writeDenial(wctx) !== null && lib.writeDenial({ ...wctx, agentId: 'a2' }) === null);
  // Under `on` a ranged Read is digested again, so the guard stays unarmed: no mark file, no deny.
  const dirOn = store();
  const onCtx = { ...wctx, store: dirOn, env: { ...readEnv, CODE_OPS_DIGEST_POST_SUBAGENT: '0' } };
  const onDigested = ['Read', 'Read'].map((n, i) => lib.digestToolResponse(n, structuredClone(read), i ? { ...onCtx, agentId: 'a3' } : onCtx));
  ok('guard: on mode digests lead and subagent Reads as before', onDigested.every((d) => d !== null));
  ok('guard: on mode writes no mark file', !existsSync(dirOn) || !readdirSync(dirOn).some((f) => f.startsWith('READ_MARKS')));
  ok('guard: on mode never refuses a Write', lib.writeDenial(onCtx) === null && lib.writeDenial({ ...onCtx, agentId: 'a3' }) === null);
  ok('guard: a lead-mode mark is not honored once the switch is on', mark() !== null && lib.writeDenial({ ...wctx, env: readEnv }) === null);
  // The marks file grows only on a digested Read or on a clear over a live mark.
  const dirG = store();
  const gctx = { ...wctx, store: dirG };
  const marksRows = () => { const f = existsSync(dirG) ? readdirSync(dirG).find((n) => n.startsWith('READ_MARKS')) : undefined; return f ? readFileSync(join(dirG, f), 'utf8').split('\n').filter(Boolean).length : 0; };
  lib.digestToolResponse('Read', structuredClone(read), { ...gctx, filePath: '/x/other.txt', ranged: true });
  ok('guard: a whole Read with no marks file creates none', marksRows() === 0);
  lib.digestToolResponse('Read', structuredClone(read), gctx);
  ok('guard: a digested Read appends one mark', marksRows() === 1);
  lib.digestToolResponse('Read', structuredClone(read), { ...gctx, ranged: true });
  ok('guard: a ranged Read over a live mark appends one clear', marksRows() === 2);
  for (let i = 0; i < 3; i++) lib.digestToolResponse('Read', structuredClone(read), { ...gctx, ranged: true });
  lib.digestToolResponse('Read', structuredClone(read), { ...gctx, filePath: '/x/other.txt', ranged: true });
  ok('guard: repeated whole Reads with no live mark append nothing', marksRows() === 2);
  const dead = join(scratch, 'not-a-dir');
  writeFileSync(dead, 'x');
  const failOpen = lib.digestToolResponse('Read', structuredClone(read), { ...wctx, store: join(dead, 'sub') });
  ok('guard: an unwritable store still digests and the Write guard fails open', failOpen !== null && lib.writeDenial({ ...wctx, store: join(dead, 'sub') }) === null);

  return fails;
}

// A copy of the library with one edit, imported from the scratch directory.
async function mutant(scratch, name, edit) {
  const src = readFileSync(libPath, 'utf8');
  const out = edit(src);
  if (out === src) throw new Error(`mutant ${name} changed nothing: the anchor moved`);
  const file = join(scratch, `lib-${name}.mjs`);
  writeFileSync(file, out);
  return import(`${pathToFileURL(file).href}?m=${name}`);
}

// Runs the hook cases against one copy of the hook (which resolves its library beside itself).
function runHookCases(hook, scratch, quiet) {
  const { fails, check } = tally((name, detail) => (detail ? `${name}: ${detail}` : name));
  const ok = quiet ? (name, cond, detail) => { if (!cond) fails.push(detail ? `${name}: ${detail}` : name); } : check;
  const fire = (stdin, env = {}) => spawnSync(process.execPath, [hook], {
    input: stdin, encoding: 'utf8',
    env: { ...process.env, CODE_OPS_DIGEST: '', CODE_OPS_DIGEST_POST: '', CODE_OPS_DIGEST_READ: '', CODE_OPS_DIGEST_DIR: join(scratch, 'hook-store'), ...env },
  });
  const payload = (tool, resp, extra = {}) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { command: 'node build.mjs' }, tool_response: resp, ...extra });
  const compound = fixture('bash-compound');

  const hit = fire(payload('Bash', compound));
  const out = hit.status === 0 && hit.stdout.trim() !== '' ? JSON.parse(hit.stdout) : null;
  ok('hook: over the threshold it exits 0 and prints the PostToolUse envelope', out?.hookSpecificOutput?.hookEventName === 'PostToolUse' && Object.keys(out).join() === 'hookSpecificOutput', hit.stdout.slice(0, 120));
  const upd = out?.hookSpecificOutput?.updatedToolOutput;
  ok('hook: the replacement keeps every key and shrinks stdout', upd !== undefined && keys(upd) === BASH_KEYS.join(',') && upd.stdout.length < compound.stdout.length / 2);
  ok('hook: a Read result is replaced when CODE_OPS_DIGEST_READ is on', fire(payload('Read', fixture('read-text')), { CODE_OPS_DIGEST_READ: '1' }).stdout.includes('updatedToolOutput'));
  const quiet0 = (r) => r.status === 0 && r.stdout === '';
  ok('hook: below the threshold it prints nothing', quiet0(fire(payload('Bash', fixture('bash-small')))));
  ok('hook: switched off it prints nothing', quiet0(fire(payload('Bash', compound), { CODE_OPS_DIGEST_POST: 'off' })) && quiet0(fire(payload('Bash', compound), { CODE_OPS_DIGEST: 'off' })));
  for (const tool of ['Grep', 'bash', 'shell', 'exec_command', 'read_file', '']) ok(`hook: tool name '${tool}' prints nothing`, quiet0(fire(payload(tool, compound))));
  ok('hook: a subagent payload uses the subagent threshold', quiet0(fire(payload('Bash', compound, { agent_id: 'a1', agent_type: 'implementer' }))));
  for (const [label, stdin] of [['malformed JSON', '{not json'], ['empty stdin', ''], ['a non-object payload', '42'], ['a null response', payload('Bash', null)], ['a string response', payload('Bash', 'text')]]) {
    ok(`hook: ${label} exits 0 with empty stdout`, quiet0(fire(stdin)));
  }
  return fails;
}

// A copy of the hook beside a copy of the repo library (scripts/, whose vendored copy the integration
// step refreshes), with one edit to the hook; the 'real' copy takes no edit.
function hookMutant(scratch, name, edit) {
  const src = readFileSync(hookPath, 'utf8');
  const out = edit(src);
  if (out === src && name !== 'real') throw new Error(`hook mutant ${name} changed nothing: the anchor moved`);
  const dir = join(scratch, `hook-${name}`);
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(libPath, join(dir, 'scripts', 'digest-lib.mjs'));
  writeFileSync(join(dir, 'hooks', 'digest-post.mjs'), out);
  return join(dir, 'hooks', 'digest-post.mjs');
}

const scratch = mkdtempSync(join(tmpdir(), 'digest-post-'));
let exitCode = 0;
try {
  const lib = await import(pathToFileURL(libPath).href);
  const fails = await runCases(lib, scratch, false);

  const mutants = [
    ['no-trailer-skip', (s) => s.replace("if (TRAILER_END_RE.test(stdout) || TRAILER_END_RE.test(stderr)) return null;", '')],
    ['lead-digests-subagent', (s) => s.replace("if (mode === 'lead' && ctx.agentId) return null;", '')],
    ['ranged-stays-digested', (s) => s.replace("mode === 'lead' && ctx.ranged === true", 'false')],
    ['mark-shared-across-threads', (s) => s.replace('m.t !== thread || m.p !== key', 'm.p !== key')],
    ['mark-never-clears', (s) => s.replace('return m.clear ? null : m;', 'return m;')],
    ['on-mode-arms-guard', (s) => s.replace("if (mode === 'lead') noteRead(", 'noteRead(')],
    ['deny-armed-in-on-mode', (s) => s.replace("readMode(env.CODE_OPS_DIGEST_READ) !== 'lead'", 'readMode(env.CODE_OPS_DIGEST_READ) === null')],
    ['clear-always-appended', (s) => s.replace('if (liveMark(file, row.t, row.p) === null) return;', '')],
    ['swapped-thresholds', (s) => s.replace("['CODE_OPS_DIGEST_POST_LEAD', 4000]", "['CODE_OPS_DIGEST_POST_LEAD', 8000]").replace("['CODE_OPS_DIGEST_POST_SUBAGENT', 8000]", "['CODE_OPS_DIGEST_POST_SUBAGENT', 4000]")],
  ];
  const { fails: mutantFails, check } = tally((name, detail) => (detail ? `${name}: ${detail}` : name));
  for (const [name, edit] of mutants) {
    const m = await runCases(await mutant(scratch, name, edit), scratch, true);
    check(`mutant ${name} is killed (${m.length} case${m.length === 1 ? '' : 's'} fail)`, m.length > 0);
  }
  fails.push(...runHookCases(hookMutant(scratch, 'real', (t) => t), scratch, false));
  const hookMutants = [
    // the first `catch { return; }` is the stdin parse
    ['print-on-bad-json', (t) => t.replace('catch { return; }', "catch { writeSync(1, 'bad payload\\n'); return; }")],
    ['drop-agent-id', (t) => t.replace("typeof payload.agent_id === 'string' && payload.agent_id !== '' ? payload.agent_id : undefined", 'undefined')],
  ];
  for (const [name, edit] of hookMutants) {
    const m = runHookCases(hookMutant(scratch, name, edit), scratch, true);
    check(`hook mutant ${name} is killed (${m.length} case${m.length === 1 ? '' : 's'} fail)`, m.length > 0);
  }
  fails.push(...mutantFails);

  if (fails.length) {
    console.error(`\ndigest-post eval FAILED (${fails.length}):`);
    for (const f of fails) console.error(`  - ${f}`);
    exitCode = 1;
  } else {
    console.log('\ndigest-post eval passed');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);
