// @ts-check
// Shared CLI primitives for the repository's scripts: flag parsing, usage, exit, a git
// wrapper, a file walker, sha256, and the Windows .cmd/.bat shim spawn rewrite.
//
// WHY: the canonical scripts/ set had grown 19 private `usage` functions, 12 private `die`
// helpers, 9 hand-rolled flag loops, three file walkers, and three git wrappers — the same
// five shapes rewritten per script, each with its own drift risk. This module is the one
// place those live.
//
// Scripts migrate onto it one domain at a time, so a migration diff stays reviewable and a
// regression stays attributable. The `scan` domain is migrated: the seven scripts behind
// `co scan <verb>` parse their flags here. Every other script keeps its private copies until
// its own domain moves.
//
// `co.mjs` deliberately does NOT import this module. A plugin can vendor `co.mjs` without the
// script a verb names, and `co.mjs` has to survive that to report it — so it stays free of
// sibling imports of its own.
//
// Library only — no side effects on import, no argv reading at module scope.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Thrown by parseFlags on a caller error (unknown flag, missing value, missing required
// flag). A caller catches it and routes the message into its own usage text, so the library
// never decides how a script reports a bad invocation.
export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// parseFlags(argv, spec) -> { flags, positional }
//
// `argv` is the argument list without the node binary and the script path. `spec` maps a
// flag name (no leading dashes) to a rule:
//   value     `true` takes the next argument, `false` is a present/absent switch
//   default   the value the flag carries when it is absent
//   required  throw when the flag is absent
//   many      collect every occurrence into an array; an absent flag is `[]`
//   raw       take a flag-shaped next argument as the value, for a flag whose own check
//             must report a smuggled option (`--git --output=x`) by name
//   missing   the message tail for a missing value, so a migrated script keeps the wording
//             its callers already pin
// Everything that is not a known flag or its value becomes a positional. A bare `--` ends
// flag parsing: every remaining argument is positional, including one that starts with a dash.
/**
 * @typedef {{ value?: boolean, default?: unknown, required?: boolean, many?: boolean, raw?: boolean, missing?: string }} FlagRule
 * @param {string[]} argv
 * @param {Record<string, FlagRule>} [spec]
 * @returns {{ flags: Record<string, any>, positional: string[] }}
 */
export function parseFlags(argv, spec = {}) {
  /** @type {Record<string, any>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  /** @type {(name: string, rule: FlagRule, value: string) => void} */
  const take = (name, rule, value) => { if (rule.many) flags[name].push(value); else flags[name] = value; };
  for (const [name, rule] of Object.entries(spec)) {
    if (rule && rule.many) flags[name] = [];
    else if (rule && 'default' in rule) flags[name] = rule.default;
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = (eq === -1 ? arg : arg.slice(0, eq)).slice(2);
    const rule = Object.hasOwn(spec, name) ? spec[name] : undefined;
    // The wording is the one every migrated gate script already reports, so a caller that
    // pins the message keeps it after the migration.
    if (!rule) throw new UsageError(`unknown argument: --${name}`);
    if (!rule.value) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    if (eq !== -1) {
      take(name, rule, arg.slice(eq + 1));
      continue;
    }
    // A following flag is not a value: `--out --json` is a missing value, not a file named
    // `--json`, the same rule the subcommand scripts already enforce by hand. `raw` opts out,
    // because a flag that rejects option smuggling has to see the smuggled token.
    const next = argv[i + 1];
    if (next === undefined || (!rule.raw && next.startsWith('--'))) {
      throw new UsageError(`--${name} ${rule.missing ?? 'requires a value'}`);
    }
    take(name, rule, next);
    i++;
  }
  for (const [name, rule] of Object.entries(spec)) {
    if (rule && rule.required && flags[name] === undefined) throw new UsageError(`--${name} is required`);
  }
  return { flags, positional };
}

// Print usage lines to stderr and exit. Usage output belongs on stderr so a script's stdout
// stays machine-readable even when the invocation was wrong.
/**
 * @param {string | string[]} lines
 * @returns {never}
 */
export function usage(lines, code = 2) {
  for (const line of Array.isArray(lines) ? lines : [lines]) console.error(line);
  process.exit(code);
}

// Print one error line to stderr and exit. The `x ` prefix matches the existing gate scripts.
/**
 * @param {string} message
 * @returns {never}
 */
export function die(message, code = 1) {
  console.error(`x ${message}`);
  process.exit(code);
}

// `--help` or `-h` before a bare `--` prints the usage text to stdout and exits 0. A help
// request is a success, not a caller error, so it skips the stderr path `usage` takes. A
// script with its own parser calls this first, so every script answers help the same way.
/**
 * @param {string[]} argv
 * @param {string} usageLine
 */
export function exitOnHelp(argv, usageLine) {
  const end = argv.indexOf('--');
  const head = end === -1 ? argv : argv.slice(0, end);
  if (!head.includes('--help') && !head.includes('-h')) return;
  console.log(usageLine);
  process.exit(0);
}

// parseFlags, reported the way a gate script reports a caller error: `x <message>` on stderr,
// the script's own usage line under it when one is given, exit 2. Every migrated script wants
// that shape, so none of them keeps a private try/catch for it.
/**
 * @param {string[]} argv
 * @param {Record<string, FlagRule>} spec
 * @param {string | null} [usageLine]
 */
export function parseOrDie(argv, spec, usageLine = null) {
  if (usageLine !== null) exitOnHelp(argv, usageLine);
  try {
    return parseFlags(argv, spec);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    usage(usageLine === null ? `x ${error.message}` : [`x ${error.message}`, usageLine], 2);
  }
}

// Run git and return trimmed stdout. stderr is discarded and stdin is closed, so a git
// subprocess can never block on a prompt or leak progress output into a report.
/** @param {string[]} args */
export function git(args, { cwd = process.cwd(), timeout = 10000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return execFileSync('git', args, { cwd, timeout, maxBuffer, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

// Walk `dir` and return absolute paths of the files `filter` accepts. `filter` receives the
// absolute path; omit it to take every file. Directories are never returned. An unreadable
// directory is skipped rather than fatal, because a walker is a discovery step, not a gate.
/**
 * @param {string} dir
 * @param {(path: string) => boolean} [filter]
 * @returns {string[]}
 */
export function walkFiles(dir, filter = () => true) {
  const out = [];
  const stack = [resolve(dir)];
  while (stack.length) {
    const current = /** @type {string} */ (stack.pop());
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && filter(full)) out.push(full);
    }
  }
  return out;
}

// Hex sha256 of a string or buffer. One copy, so every receipt, pin, and index hashes alike.
/**
 * @param {string | Buffer} value
 * @returns {string}
 */
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------- windows .cmd shims
//
// Node refuses to spawn a .cmd/.bat file without a shell (EINVAL, CVE-2024-27980 hardening),
// and a bare shim name like `npm` does not resolve at all. Handing the whole command to a
// shell would break the no-shell contract, so instead: resolve the executable, and only when
// it is a .cmd/.bat shim, rewrite the spawn to `cmd.exe /d /s /c "<line>"` with quote-for-argv
// plus a SINGLE caret pass (a deliberate deviation from cross-spawn's double pass — see
// escapeCmdArg below). run-proof.mjs, digest.mjs, and sync-global.mjs spawn through this; a
// caller with a stricter argument policy enforces it before it calls spawnSpec.

const CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g;

// The shim path itself: caret-escape every cmd metacharacter (including space) — no quotes.
/** @param {string} s */
const escapeCmdShim = (s) => s.replace(CMD_META_RE, '^$1');

// An argument: backslash-escape quotes for the target's argv parser, wrap in quotes, then
// caret-escape the cmd metacharacters once — cmd parses the /c line exactly once before
// invoking the shim, consuming one layer of carets. Single-escaping is verified against both
// shim styles: through an npm-style `%*` re-invocation shim it yields the same argv as
// cross-spawn's double-escape, and through a plain `%1` batch file the double-escape leaves
// literal `^"` in the argument while single does not.
/** @param {string} s */
function escapeCmdArg(s) {
  let a = String(s).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`;
  return a.replace(CMD_META_RE, '^$1');
}

// PATH-only lookup: the `$path:` pattern prefix stops `where` searching the working
// directory, so a repo under audit cannot plant a shim that hijacks a bare-name command, and
// a lookup resolves identically wherever it runs from.
/**
 * @param {string} exe
 * @returns {string[]}
 */
function wherePath(exe) {
  try {
    return execFileSync('where', [`$path:${exe}`], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 })
      .toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch { return []; }
}

// Returns {file, args, options} for spawn/spawnSync. On win32, a token that names (or
// resolves to) an EXISTING .cmd/.bat shim is rewritten through cmd.exe; anything that
// resolves to a real executable — or does not resolve at all — spawns unchanged, so the
// caller's normal "could not execute" path still fires for a missing command. cmd.exe must
// never be handed a name it cannot find, because cmd itself exits 1 and that would report a
// failure for a command that never ran. A relative shim path is made absolute against cwd,
// because NoDefaultCurrentDirectoryInExePath (set by common shells) stops cmd.exe from
// searching the working directory. A token carrying a wildcard is never probed — `where`
// accepts patterns, and a pattern is not a command name.
/**
 * @param {string} exe
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{ file: string, args: string[], options: { windowsVerbatimArguments?: boolean } }}
 */
export function spawnSpec(exe, args, cwd = process.cwd()) {
  const plain = { file: exe, args, options: {} };
  if (process.platform !== 'win32' || /[*?]/.test(exe)) return plain;
  let shim = null;
  if (!/[\\/]/.test(exe) && !/\.[a-z0-9]+$/i.test(exe)) {
    for (const hit of wherePath(exe)) {
      if (/\.(exe|com)$/i.test(hit)) return plain; // a real executable wins — spawn directly
      if (/\.(cmd|bat)$/i.test(hit)) { shim = hit; break; }
    }
    if (!shim) return plain;
  } else if (/\.(cmd|bat)$/i.test(exe)) {
    if (/[\\/]/.test(exe)) {
      const abs = resolve(cwd, exe);
      if (!existsSync(abs)) return plain;
      shim = abs;
    } else {
      const local = resolve(cwd, exe);
      if (existsSync(local)) shim = local;
      else shim = wherePath(exe).find((h) => /\.(cmd|bat)$/i.test(h)) ?? null;
      if (!shim) return plain;
    }
  } else return plain;
  const line = [escapeCmdShim(shim), ...args.map(escapeCmdArg)].join(' ');
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}
