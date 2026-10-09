#!/usr/bin/env node
// @ts-check
// Shell-turn compressors behind `co gh|fetch|until|each|show`: one call replaces the several
// the lead spends on gh, git status, polling loops, and read sequences.
//
//   co gh <args...>                                run gh; print exit code, stdout and stderr tails
//   co fetch [remote]                              git fetch, then branch, ahead/behind, dirty count
//   co until [--every <s>] [--timeout <s>] -- <cmd...>   rerun until exit 0 or timeout (every >= 1, default 10;
//                                                  timeout default 100 s, under the Bash tool's 120 s; pass --timeout for longer)
//   co each <cmd-template> -- <items...>           one status line per item; {} marks the item slot
//   co show <ref> [paths...]                       git show: stat plus a capped patch
//
// Rules: the verb exits with the child's own nonzero code, never 0 on a child failure. Output is
// capped, and each cap prints the dropped line count. A command spawns directly from an argument
// array (no shell), so a Windows .cmd shim such as npm is not reachable; gh, git, and node are.
// A line over 2,000 characters is clipped with a marker. `until` stops at once when the command cannot start.
// CO_RUN_TAIL sets the stream tail (default 40 lines); CO_SHOW_LINES sets the patch cap (200).
//
// Exit: the child's nonzero code; 127 when the command cannot start; 2 on caller error.

import { spawnSync } from 'node:child_process';

const TAIL = Math.max(1, Number(process.env.CO_RUN_TAIL) || 40);
const SHOW_LINES = Math.max(1, Number(process.env.CO_SHOW_LINES) || 200);
const MAX_BUFFER = 64 * 1024 * 1024;
const LINE_CAP = 2000;
// `until` waits under the Bash tool's 120 s default unless the caller passes --timeout.
const DEFAULT_TIMEOUT_S = 100;

/** @typedef {{ code: number, stdout: string, stderr: string, error: string }} Result */

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {number | undefined} [timeoutMs]
 * @returns {Result}
 */
function exec(cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs, windowsHide: true });
  if (r.error) {
    const timedOut = /** @type {NodeJS.ErrnoException} */ (r.error).code === 'ETIMEDOUT';
    return { code: timedOut ? 124 : 127, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error.message };
  }
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, error: r.status === null ? `killed by ${r.signal}` : '' };
}

/** @param {string} text @returns {string[]} */
const linesOf = (text) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/** @param {string} line */
const clipLine = (line) => (line.length > LINE_CAP ? `${line.slice(0, LINE_CAP)} [... ${line.length - LINE_CAP} chars dropped]` : line);

/**
 * Keep the last `n` lines (or the first `n` when `head`), and say how many were dropped.
 * @param {string} text
 * @param {number} n
 * @param {boolean} [head]
 * @returns {string[]}
 */
function capped(text, n, head = false) {
  const lines = linesOf(text);
  if (lines.length <= n) return lines.map(clipLine);
  const dropped = lines.length - n;
  return head
    ? [...lines.slice(0, n).map(clipLine), `[... ${dropped} more lines dropped]`]
    : [`[... ${dropped} earlier lines dropped]`, ...lines.slice(-n).map(clipLine)];
}

/** @param {string} label @param {string} text */
function printStream(label, text) {
  const lines = capped(text, TAIL);
  if (lines.length === 0) return;
  console.log(`${label}:`);
  for (const line of lines) console.log(`  ${line}`);
}

/** @param {Result} r */
function printResult(r) {
  console.log(`exit ${r.code}${r.error ? ` (${r.error})` : ''}`);
  printStream('stdout', r.stdout);
  printStream('stderr', r.stderr);
}

/** @param {string} message @returns {never} */
function usage(message) {
  console.error(`co: ${message}`);
  process.exit(2);
}

/** @param {string[]} args */
function gh(args) {
  if (args.length === 0) usage('gh needs arguments, as in: co gh pr view 12');
  const r = exec('gh', args);
  printResult(r);
  return r.code;
}

/** @param {string[]} args */
function fetchStatus(args) {
  if (args.length > 1) usage('fetch takes at most one remote');
  const remote = args[0] ?? 'origin';
  const f = exec('git', ['fetch', remote]);
  console.log(`fetch ${remote}: exit ${f.code}${f.error ? ` (${f.error})` : ''}`);
  printStream('fetch stderr', f.stderr);
  const git = (/** @type {string[]} */ a) => exec('git', a);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || '(unknown)';
  /** @param {string} base */
  const counts = (base) => {
    const r = git(['rev-list', '--left-right', '--count', `HEAD...${base}`]);
    const [ahead, behind] = r.stdout.trim().split(/\s+/);
    return r.code === 0 ? `ahead ${ahead} behind ${behind}` : 'n/a';
  };
  const upstream = git(['rev-parse', '--abbrev-ref', '@{u}']).stdout.trim();
  const mainRef = git(['rev-parse', '--verify', '--quiet', `${remote}/main`]).code === 0 ? `${remote}/main` : 'main';
  console.log(`branch ${branch}`);
  console.log(`vs upstream ${upstream || '(none)'}: ${upstream ? counts(upstream) : 'n/a'}`);
  console.log(`vs ${mainRef}: ${counts(mainRef)}`);
  console.log(`dirty files ${linesOf(git(['status', '--porcelain']).stdout).length}`);
  return f.code;
}

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {string[]} args */
function until(args) {
  const split = args.indexOf('--');
  if (split < 0 || split === args.length - 1) usage('until needs `-- <cmd...>`');
  let every = 10;
  let timeout = DEFAULT_TIMEOUT_S;
  const flags = args.slice(0, split);
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const n = Number(flags[i + 1]);
    const bad = !(n >= 0) || (flag !== '--every' && flag !== '--timeout') || (flag === '--every' && n < 1);
    if (bad) usage(`until: bad flag ${flag} ${flags[i + 1] ?? ''} (--every needs 1 or more, --timeout 0 or more)`.replace(/\s+/g, ' '));
    if (flag === '--every') every = n;
    else timeout = n;
  }
  const [cmd, ...cmdArgs] = args.slice(split + 1);
  if (cmd === undefined) usage('until needs `-- <cmd...>`');
  const start = Date.now();
  let attempts = 0;
  /** @type {Result} */
  let r;
  for (;;) {
    attempts += 1;
    const remaining = Math.max(1000, timeout * 1000 - (Date.now() - start));
    r = exec(cmd, cmdArgs, remaining);
    if (r.code === 0) break;
    // Exit 127 with an error message is a spawn failure (ENOENT, EINVAL): retrying cannot help.
    if (r.code === 127 && r.error) break;
    if (Date.now() - start + every * 1000 >= timeout * 1000) break;
    sleep(every * 1000);
  }
  const elapsed = Math.round((Date.now() - start) / 1000);
  const state = r.code === 0 ? 'succeeded' : r.code === 127 && r.error ? 'command cannot start' : `timed out after ${elapsed}s`;
  console.log(`until: ${state}, attempts ${attempts}`);
  printResult(r);
  return r.code;
}

/** @param {string[]} args */
function each(args) {
  const split = args.indexOf('--');
  if (split < 1 || split === args.length - 1) usage('each needs `<cmd-template> -- <items...>`');
  const template = args.slice(0, split);
  const items = args.slice(split + 1);
  const slotted = template.some((t) => t.includes('{}'));
  let firstFail = 0;
  let failures = 0;
  for (const item of items) {
    const argv = slotted ? template.map((t) => t.split('{}').join(item)) : [...template, item];
    const [cmd = item, ...cmdArgs] = argv;
    const r = exec(cmd, cmdArgs);
    const note = linesOf(r.code === 0 ? r.stdout : r.stderr || r.stdout).pop() ?? '';
    console.log(`${r.code === 0 ? 'ok  ' : 'FAIL'} ${r.code === 0 ? '' : `exit ${r.code} `}${item}${note ? `  ${note.slice(0, 120)}` : ''}${r.error ? ` (${r.error})` : ''}`);
    if (r.code !== 0) {
      failures += 1;
      if (firstFail === 0) firstFail = r.code;
    }
  }
  console.log(`each: ${items.length - failures} ok, ${failures} failed of ${items.length}`);
  return firstFail;
}

/** @param {string[]} args */
function show(args) {
  if (args.length === 0) usage('show needs a ref, as in: co show HEAD scripts/co.mjs');
  const [ref = '', ...paths] = args;
  if (ref === '' || ref.startsWith('-')) usage(`show: the ref must be a revision, not ${JSON.stringify(ref)}`);
  const tail = paths.length ? ['--', ...paths] : [];
  // -m --first-parent makes a merge commit show its diff against the first parent, not an empty patch.
  const merges = ['-m', '--first-parent'];
  const stat = exec('git', ['show', ...merges, '--stat', '--format=%h %s%n%an %ad', ref, ...tail]);
  if (stat.code !== 0) {
    printResult(stat);
    return stat.code;
  }
  for (const line of capped(stat.stdout, SHOW_LINES, true)) console.log(line);
  const patch = exec('git', ['show', ...merges, '--format=', '--patch', ref, ...tail]);
  if (patch.code !== 0) {
    printResult(patch);
    return patch.code;
  }
  const patchLines = capped(patch.stdout, SHOW_LINES, true);
  console.log(patchLines.length ? 'patch:' : 'patch: (none)');
  for (const line of patchLines) console.log(line);
  return 0;
}

const VERBS = { gh, fetch: fetchStatus, until, each, show };
const [verb, ...rest] = process.argv.slice(2);
if (!verb || !Object.hasOwn(VERBS, verb)) usage(`co-run verbs: ${Object.keys(VERBS).join(', ')}`);
process.exitCode = VERBS[/** @type {keyof typeof VERBS} */ (verb)](rest);
