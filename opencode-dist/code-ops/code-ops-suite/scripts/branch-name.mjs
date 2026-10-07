#!/usr/bin/env node
// The branch-name rule: a branch name says what the change is about, never which tool made it.
//
// WHY: a branch such as claude/beautiful-lehmann-0bd3b1 publishes an AI-tool prefix that sidesteps
// the traceless-publishing rule, and it names no topic. One rule here feeds every publishing path:
// the enforce-traceless tool hook, the tracked pre-commit and pre-push git hooks, and the CI step
// "Traceless publishing (PR commits, title, body)".
//
// The rule has two problems, and a name with either one fails.
//   1. AI-tool prefix. The first segment equals, ignoring case, a name in AI_PREFIXES. The first
//      segment is the text before the first "/", or before the first "-" or "_" when the name has
//      no "/". A tool name later in the name is a topic, not a prefix: eng/codex-render passes.
//   2. Generated name. The last "-" separated token of the last "/" segment holds 6 or more
//      lowercase letters and digits, with at least one of each, and is not version-like. Tokens
//      matching ^v?\d+[a-z]?$ or ^[a-z]+\d+$ pass: v2, p8, r1, u3, and a word with a number
//      suffix (round2, check22), which real topics use and a random token does not. Session
//      names such as beautiful-lehmann-0bd3b1 and code-ops-session-limits-jis1gr end in one.
//
//   node scripts/branch-name.mjs check [<name>]
//
// Without <name>, the CLI checks the current branch (a detached HEAD passes).
// Exit: 0 = clean, 1 = the name has a problem, 2 = usage error or a git failure.
//
// The library half (commandBranchViolations) reads a shell command and finds the branch names it
// would create, rename, commit on, push, or open a pull request from. The tool hook calls it.
// It is a best-effort reader of simple command shapes: a name it cannot see falls to the git hooks
// and CI, which check the real branch.

import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AI_PREFIXES = [
  'claude', 'codex', 'copilot', 'cursor', 'gemini', 'grok', 'opencode', 'aider', 'devin',
  'chatgpt', 'gpt', 'openai', 'anthropic', 'ai', 'agent', 'worktree',
];

const GENERATED_TOKEN = /^(?=.*\d)(?=.*[a-z])[a-z0-9]{6,}$/;
const VERSION_LIKE = /^(?:v?\d+[a-z]?|[a-z]+\d+)$/;

export const FIX_TEXT =
  'Rename the branch: git branch -m <descriptive-name>, with a topic prefix such as eng/, fix/, or docs/ ' +
  '(for example eng/branch-name-gate). Rule: scripts/branch-name.mjs.';

/** @param {string} name @returns {string[]} human-readable problems; empty means the name is fine */
export function branchNameProblems(name) {
  if (typeof name !== 'string' || !name) return [];
  const problems = [];
  const first = (name.includes('/') ? name.split('/')[0] : name.split(/[-_]/)[0]).toLowerCase();
  if (AI_PREFIXES.includes(first)) {
    problems.push(`branch "${name}" starts with the AI-tool name "${first}", which hides the topic and sidesteps the attribution rule`);
  }
  const lastToken = (name.split('/').pop() ?? '').split('-').pop() ?? '';
  if (GENERATED_TOKEN.test(lastToken) && !VERSION_LIKE.test(lastToken)) {
    problems.push(`branch "${name}" ends in "${lastToken}", a generated random token, and names no topic`);
  }
  return problems;
}

/** @param {string[]} problems @returns {string} the error text: each problem, then the fix */
export function formatProblems(problems) {
  return `${problems.map((p) => `Branch-name gate: ${p}.`).join('\n')}\n${FIX_TEXT}`;
}

/**
 * The current branch of the checkout at `dir`, or null on a detached HEAD.
 * Throws when git cannot answer (not a repository, git missing).
 * @param {string} dir @returns {string | null}
 */
export function currentBranch(dir) {
  const r = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
  if (r.error) throw r.error;
  if (r.status === 0) return r.stdout.trim() || null;
  if (r.status === 1) return null; // -q: HEAD is not a symbolic ref, so it is detached
  throw new Error((r.stderr || `git exited ${r.status}`).trim());
}

// ---- reading a shell command -------------------------------------------------------------

// Split a shell command into segments (at && || ; | & and newline outside quotes) of unquoted
// tokens. A heredoc body is skipped. Substitutions and redirections are not interpreted.
function splitCommand(command) {
  const segments = [];
  let tokens = [];
  let cur = null;
  let quote = null;
  const heredocs = [];
  const endToken = () => { if (cur !== null) { tokens.push(cur); cur = null; } };
  const endSegment = () => { endToken(); if (tokens.length) segments.push(tokens); tokens = []; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && next !== undefined && '"\\$`'.includes(next)) cur += command[++i];
      else cur += c;
      continue;
    }
    if (c === '\\' && next !== undefined && ' "\'\\\n'.includes(next)) { cur = (cur ?? '') + command[++i]; continue; }
    if (c === "'" || c === '"') { quote = c; cur ??= ''; continue; }
    if (c === '<' && next === '<' && command[i + 2] !== '<') {
      const m = /^<<-?\s*(?:'([^']*)'|"([^"]*)"|([^\s;&|<>()]+))/.exec(command.slice(i));
      if (m) { heredocs.push(m[1] ?? m[2] ?? m[3]); i += m[0].length - 1; endToken(); continue; }
    }
    if (c === '\n' && heredocs.length) {
      let pos = i + 1;
      for (const delimiter of heredocs.splice(0)) {
        while (pos < command.length) {
          const end = command.indexOf('\n', pos);
          const line = command.slice(pos, end === -1 ? command.length : end);
          pos = end === -1 ? command.length : end + 1;
          if (line.trim() === delimiter) break;
        }
      }
      endSegment();
      i = pos - 1;
      continue;
    }
    if (c === '&' || c === '|' || c === ';' || c === '\n') { endSegment(); continue; }
    if (/\s/.test(c)) { endToken(); continue; }
    cur = (cur ?? '') + c;
  }
  endSegment();
  return segments;
}

function resolveDir(base, dir) {
  let d = dir;
  if (process.platform === 'win32') d = d.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:'); // /c/Users -> C:/Users
  d = d.replace(/^~(?=[/\\]|$)/, homedir());
  return resolve(base, d);
}

// The value that follows an option in `args`: --opt value, --opt=value, or -o value.
function optionValues(args, names) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n && args[i + 1] !== undefined) out.push(args[i + 1]);
      else if (n.startsWith('--') && args[i].startsWith(`${n}=`)) out.push(args[i].slice(n.length + 1));
    }
  }
  return out;
}

// Positional arguments: everything that is not an option or the value of a listed value option.
function positionals(args, valueOptions = []) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') { out.push(...args.slice(i + 1)); break; }
    if (valueOptions.includes(args[i])) { i++; continue; }
    if (!args[i].startsWith('-')) out.push(args[i]);
  }
  return out;
}

// `git [global options] <sub> <args>` -> { sub, args, dir }, or null when the segment is not git.
function parseGit(tokens, dir) {
  let i = 0;
  while (/^[A-Za-z_]\w*=/.test(tokens[i] ?? '')) i++;
  if (tokens[i] !== 'git') return null;
  i++;
  let gitDir = dir;
  for (; i < tokens.length && tokens[i].startsWith('-'); i++) {
    if (tokens[i] === '-C' && tokens[i + 1] !== undefined) gitDir = resolveDir(gitDir, tokens[++i]);
    else if (['-c', '--git-dir', '--work-tree', '--namespace'].includes(tokens[i])) i++;
  }
  return i < tokens.length ? { sub: tokens[i], args: tokens.slice(i + 1), dir: gitDir } : null;
}

const BRANCH_NON_CREATING =
  /^(?:-[dDlrav]+|--(?:delete|list|all|remotes|verbose|show-current|edit-description|contains|no-contains|merged|no-merged|points-at|sort|format|set-upstream-to|unset-upstream|column|no-column|abbrev|color|no-color)(?:=.*)?|-u)$/;

/**
 * Every branch name in `command` that the rule must check, with the problems it has.
 * `cwd` is the directory the command starts in; `cd <dir> &&` and `git -C <dir>` move it.
 * `current(dir)` answers the current branch and defaults to a real git lookup.
 * @param {string} command @param {string} cwd @param {(dir: string) => string | null} [current]
 * @returns {{ name: string, source: string, problems: string[] }[]}
 */
export function commandBranchViolations(command, cwd, current = currentBranch) {
  const found = [];
  const seen = new Set();
  const add = (name, source) => {
    if (!name || name.startsWith('-') || seen.has(`${name}\0${source}`)) return;
    seen.add(`${name}\0${source}`);
    const problems = branchNameProblems(name);
    if (problems.length) found.push({ name, source, problems });
  };
  let dir = cwd;
  // After a command in this one switches or renames the branch, git has not run yet, so the real
  // current branch is stale: use the new name, or null (unknown) when a plain checkout moved it.
  let override;
  let overrideDir = dir;
  const addCurrent = (at, source) => {
    if (override !== undefined && overrideDir === at) { add(override, source); return; }
    let name = null;
    try { name = current(at); } catch { /* infrastructure failure: fail open for this lookup */ }
    add(name, source);
  };
  const setOverride = (at, value) => { override = value; overrideDir = at; };

  for (const tokens of splitCommand(command)) {
    const head = tokens[0].replace(/^(?:\$\(|[({]+)/, '');
    if (head === 'cd' && tokens[1] && tokens[1] !== '-') { dir = resolveDir(dir, tokens[1]); continue; }

    if (head === 'gh' && tokens[1] === 'pr' && tokens[2] === 'create') {
      addCurrent(dir, 'gh pr create');
      for (const value of optionValues(tokens.slice(3), ['--head', '-H'])) add(value.slice(value.lastIndexOf(':') + 1), 'gh pr create --head');
      continue;
    }

    const git = parseGit([head, ...tokens.slice(1)], dir);
    if (!git) continue;
    const { sub, args, dir: at } = git;

    if (sub === 'commit') addCurrent(at, 'git commit');

    else if (sub === 'push') {
      if (args.some((a) => a === '-d' || a === '--delete')) continue; // removing a remote ref is how a bad name gets fixed
      addCurrent(at, 'git push');
      const [, ...refspecs] = positionals(args, ['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
      for (const refspec of refspecs) {
        const spec = refspec.replace(/^\+/, '');
        const colon = spec.indexOf(':');
        if (colon === 0) continue; // :<ref> deletes the remote ref
        let dest = colon === -1 ? spec : spec.slice(colon + 1);
        if (dest.startsWith('refs/') && !dest.startsWith('refs/heads/')) continue; // a tag or note ref
        dest = dest.replace(/^refs\/heads\//, '');
        if (dest === 'HEAD') addCurrent(at, 'git push');
        else add(dest, 'git push refspec');
      }
    }

    else if (sub === 'checkout' || sub === 'switch') {
      const create = optionValues(args, ['-b', '-B', '-c', '-C', '--orphan', '--create', '--force-create']);
      if (create.length) {
        for (const name of create) add(name, `git ${sub} (create)`);
        setOverride(at, create[0]);
      } else if (positionals(args).length) {
        setOverride(at, null);
      }
    }

    else if (sub === 'branch') {
      if (args.some((a) => BRANCH_NON_CREATING.test(a))) continue;
      const names = positionals(args);
      const rename = args.some((a) => a === '-m' || a === '-M' || a === '--move');
      const copy = args.some((a) => a === '-c' || a === '-C' || a === '--copy');
      if (rename || copy) {
        const target = names.length > 1 ? names[1] : names[0];
        add(target, `git branch (${rename ? 'rename' : 'copy'})`);
        if (rename && names.length === 1) setOverride(at, target);
      } else {
        add(names[0], 'git branch (create)');
      }
    }

    else if (sub === 'worktree' && args[0] === 'add') {
      const rest = args.slice(1);
      const named = optionValues(rest, ['-b', '-B']);
      for (const name of named) add(name, 'git worktree add -b');
      const [path, commitish] = positionals(rest, ['-b', '-B', '--reason']);
      // With no -b, -B, or --detach and no commit-ish, git names the new branch after the path.
      if (!named.length && !rest.includes('--detach') && !rest.includes('-d') && path && !commitish) {
        add(basename(path.replace(/[/\\]+$/, '')), 'git worktree add (branch named after the path)');
      }
    }
  }
  return found;
}

// ---- CLI ---------------------------------------------------------------------------------

function main(argv) {
  const [verb, ...rest] = argv;
  if (verb !== 'check' || rest.length > 1) {
    console.error('usage: branch-name.mjs check [<name>]');
    return 2;
  }
  let name = rest[0];
  if (name === undefined) {
    try {
      name = currentBranch(process.cwd());
    } catch (e) {
      console.error(`branch-name: cannot read the current branch: ${e.message}`);
      return 2;
    }
    if (name === null) return 0; // detached HEAD
  }
  const problems = branchNameProblems(name);
  if (problems.length) {
    console.error(formatProblems(problems));
    return 1;
  }
  console.log(`OK: branch name "${name}" is descriptive`);
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isEntryPoint()) process.exit(main(process.argv.slice(2)));
