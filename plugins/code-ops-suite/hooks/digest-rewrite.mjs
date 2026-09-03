#!/usr/bin/env node
// PreToolUse hook: opt-in rewrite of a simple Bash command into a digest run, so tool output
// enters the context compressed and receipted instead of whole.
//
// Reads a coding-agent PreToolUse payload from stdin. When the switch is on and the command
// meets the simple-command contract below, the hook returns `updatedInput` carrying
// `node "<plugin>/scripts/digest.mjs" [--cwd "<dir>"] -- <original tokens verbatim>` plus one
// line of `additionalContext`. Everything else passes through untouched.
//
//   node hooks/digest-rewrite.mjs   (reads the PreToolUse JSON payload on stdin)
//
// OPT-IN. The hook does nothing unless `CODE_OPS_DIGEST` is `1`, `on`, or `true`
// (case-insensitive). A repository opts in through the `env` block of its
// `.claude/settings.json`, which is the only supported way. Any other value, including unset
// and `off`, exits 0 before the payload is read.
//
// SIMPLE-COMMAND CONTRACT. A rewrite happens only when every one of these holds:
//   - the command is at most 2000 characters;
//   - after an optional single leading `cd <dir> && `, the rest carries no `|`, `&`, `;`, `<`,
//     `>`, backtick, `$`, or newline, in any position — so no pipe, list, redirect, subshell,
//     expansion, or heredoc can survive;
//   - every token is bare (`[A-Za-z0-9_./\:@%+=,~^-]+`) or one double-quoted string holding
//     none of `"`, `$`, backtick, backslash, or newline;
//   - the first token names an allowlisted family, under the subcommand and second-token rules
//     in FAMILIES below;
//   - the command is not already a digest run.
// The `cd` directory token additionally carries no backslash: the hook hands it to `--cwd` as a
// path, where a POSIX shell would have read a backslash as an escape and reached a different
// directory. Every other token is appended verbatim into the same shell position it came from,
// which is why the contract can promise the shell reads it the same way in both positions.
//
// PERMISSION. The hook returns no `permissionDecision`. The installed host re-runs its whole
// permission evaluation against the rewritten command, so the operator's own rules decide the
// digest run as they would decide any other `node` call. The CONTRACTS section "Digest rewrite
// hook" carries the bundle evidence for that.
//
// FAIL-OPEN on every path: bad JSON, a missing command, another tool, or any thrown error exits
// 0 with no output. The hook never exits 2, never blocks, and never spawns or imports anything,
// because it sits in front of every Bash call and owns a latency budget in the tens of
// milliseconds.

import { readFileSync, writeSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_COMMAND = 2000;

// A bare token, and a double-quoted token whose body cannot change meaning between two
// positions on one command line.
const BARE_RE = /^[A-Za-z0-9_./\\:@%+=,~^-]+$/;
const QUOTED_RE = /^"[^"$`\\\n]*"$/;
// The `cd` target drops `\` from the bare set: `--cwd` takes it as a path, not as shell input.
const CD_BARE_RE = /^[A-Za-z0-9_./:@%+=,~^-]+$/;
// Any of these anywhere in the remainder means the shell would do more than run one command.
const METACHAR_RE = /[|&;<>`$\n\r]/;

// Command word to rule. `null` means the bare word is enough; a Set means the second token must
// be in it; a function decides the cases a list cannot.
const FAMILIES = {
  git: new Set(['diff', 'show', 'status', 'log', 'ls-files', 'blame']),
  gh: new Set(['pr', 'issue', 'run', 'api']),
  npm: new Set(['test', 'run']),
  pnpm: new Set(['test', 'run']),
  cargo: new Set(['test', 'build', 'check', 'clippy']),
  go: new Set(['test', 'build', 'vet']),
  grep: null,
  rg: null,
  cat: null,
  ls: null,
  find: null,
  tree: null,
  pytest: null,
  tsc: null,
  eslint: null,
  ruff: null,
  sed: (t) => (t[1] ?? '').startsWith('-n'),
  node: (t) => /\.(mjs|js)$/.test(t[1] ?? '') || t[1] === '--test',
};

// `gh` writes structured output on request, and digesting structured output is the wrong tool:
// the caller asked for something a parser reads, not something a person reads.
const GH_STRUCTURED = new Set(['--json', '--jq', '--template']);

const unquote = (t) => (t.startsWith('"') ? t.slice(1, -1) : t);

// Splits on runs of spaces and tabs, keeping one double-quoted span per token and every token's
// bytes exactly as written. Returns null when a quote opens mid-token, closes mid-token, or
// never closes, and when any token fails the contract — each of those is a pass-through, never
// a repair.
function tokenize(command) {
  const tokens = [];
  const end = command.length;
  let i = 0;
  while (i < end) {
    while (i < end && (command[i] === ' ' || command[i] === '\t')) i++;
    if (i >= end) break;
    const start = i;
    let quoted = false;
    while (i < end && command[i] !== ' ' && command[i] !== '\t') {
      if (command[i] === '"') {
        if (i !== start) return null; // a quote may only open a token
        quoted = true;
        i++;
        while (i < end && command[i] !== '"') i++;
        if (i >= end) return null; // never closed
        i++;
        if (i < end && command[i] !== ' ' && command[i] !== '\t') return null; // closed mid-token
        break;
      }
      i++;
    }
    const token = command.slice(start, i);
    if (quoted ? !QUOTED_RE.test(token) : !BARE_RE.test(token)) return null;
    tokens.push(token);
  }
  return tokens;
}

function allowedFamily(tokens) {
  const values = tokens.map(unquote);
  const head = values[0];
  if (!Object.hasOwn(FAMILIES, head)) return false;
  const rule = FAMILIES[head];
  if (rule === null) return true;
  if (typeof rule === 'function') return rule(values);
  if (!rule.has(values[1] ?? '')) return false;
  if (head === 'gh' && values.some((v) => GH_STRUCTURED.has(v))) return false;
  return true;
}

// Returns the rewritten command, or null to pass through.
function rewrite(command, scriptPath) {
  const trimmed = command.trim();
  if (trimmed === '' || trimmed.length > MAX_COMMAND) return null;

  // Exactly one leading `cd <dir> && ` is allowed; whatever follows it must be metachar-free.
  let dir = null;
  let rest = trimmed;
  const cd = /^cd[ \t]+("[^"\n]*"|[^ \t\n]+)[ \t]*&&[ \t]*/.exec(trimmed);
  if (cd) {
    dir = cd[1];
    if (!CD_BARE_RE.test(dir) && !QUOTED_RE.test(dir)) return null;
    rest = trimmed.slice(cd[0].length);
  }
  if (rest === '' || METACHAR_RE.test(rest)) return null;

  const tokens = tokenize(rest);
  if (tokens === null || tokens.length === 0) return null;
  // Never double-wrap: a command that already runs the digest passes through as it stands.
  if (unquote(tokens[0]) === 'node' && unquote(tokens[1] ?? '').endsWith('digest.mjs')) return null;
  if (!allowedFamily(tokens)) return null;

  const cwd = dir === null ? '' : ` --cwd ${dir.startsWith('"') ? dir : `"${dir}"`}`;
  return `node "${scriptPath}"${cwd} -- ${tokens.join(' ')}`;
}

const CONTEXT = 'Output digested by code-ops: elided regions carry a sed hint into the raw file '
  + 'named in the trailer; run the original command only if you need the whole output.';

function main() {
  if (!/^(1|on|true)$/i.test(process.env.CODE_OPS_DIGEST ?? '')) return;

  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return; }
  if (payload?.tool_name !== 'Bash') return;
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') return;

  // Resolved from this file, the way enforce-traceless.mjs resolves the scanner. Forward slashes
  // so the quoted path carries no backslash for the shell to read as an escape.
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'digest.mjs')
    .replaceAll('\\', '/');
  if (/["$`]/.test(scriptPath) || !existsSync(scriptPath)) return;

  const rewritten = rewrite(command, scriptPath);
  if (rewritten === null) return;

  // The whole tool input carries forward with the command replaced, so a caller's description,
  // timeout, or background flag survives the rewrite.
  writeSync(1, `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: { ...payload.tool_input, command: rewritten },
      additionalContext: CONTEXT,
    },
  })}\n`);
}

try { main(); } catch { /* fail open: a hook error must never cost the operator a tool call */ }
process.exit(0);
