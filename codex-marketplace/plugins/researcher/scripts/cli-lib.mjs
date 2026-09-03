// Shared CLI primitives for the repository's scripts: flag parsing, usage, exit, a git
// wrapper, and a file walker.
//
// WHY: the canonical scripts/ set had grown 19 private `usage` functions, 12 private `die`
// helpers, 9 hand-rolled flag loops, three file walkers, and three git wrappers — the same
// five shapes rewritten per script, each with its own drift risk. This module is the one
// place those live.
//
// Scripts migrate onto it one domain at a time, so a migration diff stays reviewable and a
// regression stays attributable. This slice migrates none of them: every existing script keeps
// its private copies until its domain moves, and this module has no consumer yet beyond its
// regression eval. It ships now, and beside `scripts/co.mjs`, so the first domain migration is
// a one-file diff rather than a new file plus four vendored copies plus a version bump.
//
// `co.mjs` deliberately does NOT import this module. A plugin can vendor `co.mjs` without the
// script a verb names, and `co.mjs` has to survive that to report it — so it stays free of
// sibling imports of its own.
//
// Library only — no side effects on import, no argv reading at module scope.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Thrown by parseFlags on a caller error (unknown flag, missing value, missing required
// flag). A caller catches it and routes the message into its own usage text, so the library
// never decides how a script reports a bad invocation.
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// parseFlags(argv, spec) -> { flags, positional }
//
// `argv` is the argument list without the node binary and the script path. `spec` maps a
// flag name (no leading dashes) to `{ value, required, default }`. `value: true` takes the
// next argument; `value: false` is a boolean present/absent switch. Everything that is not
// a known flag or its value becomes a positional. A bare `--` ends flag parsing: every
// remaining argument is positional, including one that starts with a dash.
export function parseFlags(argv, spec = {}) {
  const flags = {};
  const positional = [];
  for (const [name, rule] of Object.entries(spec)) {
    if (rule && 'default' in rule) flags[name] = rule.default;
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
    if (!rule) throw new UsageError(`unknown flag: --${name}`);
    if (!rule.value) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    if (eq !== -1) {
      flags[name] = arg.slice(eq + 1);
      continue;
    }
    // A following flag is not a value: `--out --json` is a missing value, not a file named
    // `--json`, the same rule the subcommand scripts already enforce by hand.
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new UsageError(`--${name} requires a value`);
    flags[name] = next;
    i++;
  }
  for (const [name, rule] of Object.entries(spec)) {
    if (rule && rule.required && flags[name] === undefined) throw new UsageError(`--${name} is required`);
  }
  return { flags, positional };
}

// Print usage lines to stderr and exit. Usage output belongs on stderr so a script's stdout
// stays machine-readable even when the invocation was wrong.
export function usage(lines, code = 2) {
  for (const line of Array.isArray(lines) ? lines : [lines]) console.error(line);
  process.exit(code);
}

// Print one error line to stderr and exit. The `x ` prefix matches the existing gate scripts.
export function die(message, code = 1) {
  console.error(`x ${message}`);
  process.exit(code);
}

// Run git and return trimmed stdout. stderr is discarded and stdin is closed, so a git
// subprocess can never block on a prompt or leak progress output into a report.
export function git(args, { cwd = process.cwd(), timeout = 10000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return execFileSync('git', args, { cwd, timeout, maxBuffer, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

// Walk `dir` and return absolute paths of the files `filter` accepts. `filter` receives the
// absolute path; omit it to take every file. Directories are never returned. An unreadable
// directory is skipped rather than fatal, because a walker is a discovery step, not a gate.
export function walkFiles(dir, filter = () => true) {
  const out = [];
  const stack = [resolve(dir)];
  while (stack.length) {
    const current = stack.pop();
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
