#!/usr/bin/env node
// Per-host workspace layout: where an agent makes worktrees and scratch files inside a repository,
// and an advisory-only check that says so. Nothing here blocks, rewrites, or denies a tool call.
//
// WHY: agents scatter worktrees as siblings of the repository, nest worktrees inside worktrees, and
// leave scratch files in the working tree. One folder per host, ignored by git, keeps them findable
// and out of `git status`:
//
//   <top>/<folder>/.tmp          scratch, one per checkout, so a worktree has its own
//   <mainTop>/<folder>/worktrees worktrees, one per repository, so they never nest
//
// `top` is the nearest ancestor holding a `.git` entry. `mainTop` is the main checkout, found by
// following a worktree's `.git` file with one file read and no git process (the walk
// handoff-state.mjs repoIdentity does). Each folder holds a `.gitignore` of `*`; the host folder
// itself (`.claude/` may hold tracked settings) is never given one.
//
//   node scripts/workspace-layout.mjs path [tmp|worktrees] [--host <h>] [--cwd <dir>]
//   node scripts/workspace-layout.mjs ensure [--host <h>] [--cwd <dir>]
//   node scripts/workspace-layout.mjs check [--strict] [--host <h>] [--cwd <dir>]
//
// `check` lists `git worktree list --porcelain` entries as main, in-layout, host-managed, or stray,
// and reports a layout folder that lacks its ignore file. It exits 0 unless `--strict` finds a stray
// worktree or a missing ignore file. Exit 2 is a usage error or a working directory outside git.
//
// ADVISORY RULES, called by hooks/dispatch-guard.mjs on every tool call (no extra hook process):
// `adviseWrite` speaks for a write outside the repository, the host and temp directories; and
// `adviseCommand` speaks for a `git worktree add` whose path is outside the worktrees folder. Both
// return one line or null. When in doubt they return null: an unparseable command, a variable, a
// subshell, or any error is silence. `CODE_OPS_WORKSPACE_GUARD` of `off`, `0`, or `false` turns the
// advisory and the SessionStart setup off; the CLI always works.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { worktreeAddPositionals } from './branch-name.mjs';

// Codex differs: it keeps `.codex` read-only under workspace-write, even inside writable_roots
// (https://learn.chatgpt.com/docs/agent-approvals-security), so its folder cannot be `.codex`.
export const HOST_FOLDERS = {
  claude: '.claude',
  codex: '.codex-work',
  grok: '.grok',
  opencode: '.opencode',
  copilot: '.copilot',
  other: '.agent-work',
};

const GIT_WALK_LIMIT = 64;
const SELF = fileURLToPath(import.meta.url);
const IGNORE_ALL = '*\n';
const off = (value) => /^(off|0|false)$/i.test(value ?? '');

/** True when the workspace guard and session setup are switched off. @param {Record<string, string | undefined>} [env] */
export const workspaceGuardOff = (env = process.env) => off(env.CODE_OPS_WORKSPACE_GUARD);

// The order is agent-ledger.mjs hostOf's (kept in step by hand, except CODEX_HOME), then Copilot. The COPILOT_ prefix
// is UNVERIFIED against a captured Copilot environment.
export function detectHost(env = process.env) {
  if (env.GROK_PLUGIN_ROOT) return 'grok';
  const names = Object.keys(env);
  // CODEX_HOME alone does not name Codex: it can be set globally, so a Claude session may carry it.
  if (names.some((name) => name.startsWith('CODEX_') && name !== 'CODEX_HOME')) return 'codex';
  if (names.some((name) => name.startsWith('CLAUDE_'))) return 'claude';
  if (names.some((name) => name.startsWith('OPENCODE'))) return 'opencode';
  if (names.some((name) => name.startsWith('COPILOT_'))) return 'copilot';
  return 'other';
}

// Forward slashes read the same in bash, PowerShell, and git.
const fwd = (path) => path.replace(/\\/g, '/');
// A path with a space needs quotes to be pasted into a command.
const quoted = (path) => (/\s/.test(path) ? `"${path}"` : path);

function within(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * The layout for a working directory, or null outside a git repository. `mainTop` and `worktrees`
 * are null for a linked worktree whose main checkout cannot be established (a bare or
 * --separate-git-dir repository, or a stale `.git` file), so no caller nests a worktree.
 * @param {string} cwd @param {string} [host]
 * @returns {{ host: string, folder: string, top: string, mainTop: string | null, tmp: string, worktrees: string | null } | null}
 */
export function resolveLayout(cwd, host = detectHost()) {
  try {
    // A relative cwd would resolve against this process's directory, some other repository.
    if (!isAbsolute(cwd)) return null;
    const name = Object.hasOwn(HOST_FOLDERS, host) ? host : 'other';
    let dir = resolve(cwd);
    for (let i = 0; i < GIT_WALK_LIMIT; i++) {
      const dotgit = join(dir, '.git');
      let stat = null;
      try { stat = statSync(dotgit); } catch { /* not here */ }
      if (stat) {
        let mainTop = dir;
        if (stat.isFile()) {
          // A worktree's `.git` file names `<common>/worktrees/<name>`; a submodule's does not.
          const match = /^gitdir:[^\S\r\n]*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
          if (!match) return null;
          const gitDir = resolve(dir, match[1]);
          const common = dirname(dirname(gitDir));
          if (basename(dirname(gitDir)) === 'worktrees') {
            // The main checkout is the parent of a `.git` common directory that exists. Anything else
            // (bare, separate git dir, stale file) leaves it unknown.
            mainTop = basename(common) === '.git' && existsSync(gitDir) && existsSync(common) ? dirname(common) : null;
          }
        }
        const folder = HOST_FOLDERS[name];
        return { host: name, folder, top: dir, mainTop, tmp: join(dir, folder, '.tmp'), worktrees: mainTop ? join(mainTop, folder, 'worktrees') : null };
      }
      const up = dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  } catch { /* fail open: no layout */ }
  return null;
}

// True when the folder's own ignore file has a `*` line, so git ignores what the folder holds.
function ignoresAll(dir) {
  try { return readFileSync(join(dir, '.gitignore'), 'utf8').split(/\r?\n/).some((line) => line.trim() === '*'); } catch { return false; }
}

/**
 * Creates the scratch and worktree folders, each with an ignore file when it has none. Idempotent,
 * never overwrites, never throws. Returns the folders that are ready: present, with a `*` ignore file.
 * A layout rooted at the home directory is left alone, and a worktrees folder of unknown home is skipped.
 * @param {{ top: string, mainTop: string | null, tmp: string, worktrees: string | null } | null} layout
 */
export function ensureLayout(layout) {
  const ready = [];
  if (!layout || [layout.top, layout.mainTop].some((root) => root && within(homedir(), root) && within(root, homedir()))) return ready;
  for (const dir of [layout.tmp, layout.worktrees]) {
    if (!dir) continue;
    try {
      mkdirSync(dir, { recursive: true });
      try { writeFileSync(join(dir, '.gitignore'), IGNORE_ALL, { flag: 'wx' }); } catch { /* present, or unwritable: leave it */ }
      if (ignoresAll(dir)) ready.push(dir);
    } catch { /* fail open */ }
  }
  return ready;
}

// ---- advisories ----------------------------------------------------------------------------

// Directories a write may legitimately target: the temp directory the host's scratchpad lives in,
// each host's own home, and the code-ops home.
function allowedRoots(env, home, temp) {
  const roots = [temp, join(home, '.claude'), join(home, '.codex'), join(home, '.grok'), join(home, '.config', 'opencode'), join(home, '.copilot')];
  for (const name of ['CODEX_HOME', 'GROK_HOME', 'COPILOT_HOME', 'CODE_OPS_HOME', 'CLAUDE_CODE_TMPDIR']) if (env[name]) roots.push(resolve(env[name]));
  if (env.XDG_CONFIG_HOME) roots.push(join(resolve(env.XDG_CONFIG_HOME), 'opencode'));
  return roots;
}

// The nearest ancestor of `path` that exists, resolved through symlinks, with the rest re-appended.
function realish(path) {
  const tail = [];
  let dir = path;
  for (;;) {
    try { return join(realpathSync.native(dir), ...tail.reverse()); } catch { /* climb */ }
    const up = dirname(dir);
    if (up === dir) return path;
    tail.push(basename(dir));
    dir = up;
  }
}

const insideAny = (roots, target) => roots.some((root) => within(root, target));

/**
 * One advisory line for a write outside the repository, or null.
 * @param {string} filePath @param {{ cwd: string, host?: string, env?: Record<string, string | undefined>, home?: string, tmpdir?: string }} ctx
 */
export function adviseWrite(filePath, ctx) {
  try {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) return null;
    const env = ctx.env ?? process.env;
    const layout = resolveLayout(ctx.cwd, ctx.host ?? detectHost(env));
    if (!layout) return null;
    const target = resolve(ctx.cwd, filePath);
    const roots = [layout.top, layout.mainTop, ...allowedRoots(env, ctx.home ?? homedir(), ctx.tmpdir ?? tmpdir())].filter(Boolean);
    if (insideAny(roots, target)) return null;
    // Symlinked temp or home directories (macOS /var, Windows short names) compare by real path.
    if (insideAny(roots.map(realish), realish(target))) return null;
    return `Workspace note: ${fwd(dirname(target))} is outside the repository (${fwd(layout.top)}). `
      + `The path is fine if the user asked for it; otherwise write scratch files under ${quoted(fwd(layout.tmp))} (co workspace ensure creates it).`;
  } catch { return null; }
}

// ---- reading one `git worktree add` command, with certainty or not at all ------------------

// Anything that makes a path or a directory depend on the shell's own evaluation.
const UNCERTAIN = /[$`(){}<>|;\n\r*?[\]!]/;
const WORKTREE_ADD_HINT = /\bgit\b[\s\S]*\bworktree\b[\s\S]*\badd\b/;

// Quote-aware words of one segment, or null when a quote is left open. Backslashes are literal
// only for PowerShell; elsewhere they escape, so a segment holding one is null.
function words(segment, powershell) {
  if (!powershell && segment.includes('\\')) return null;
  const out = [];
  let cur = null;
  let quote = null;
  for (const c of segment) {
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; cur ??= ''; continue; }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? '') + c;
  }
  if (quote) return null;
  if (cur !== null) out.push(cur);
  return out;
}

// A path word as an absolute path from `base`, or null when it is not a plain literal.
function literalPath(base, word) {
  if (!word || word === '-' || /^~[^/\\]/.test(word) || word.includes('%')) return null;
  // On Windows a rooted `/c/x` is a Git Bash drive path; any other rooted form cannot be placed with certainty.
  if (process.platform === 'win32' && word.startsWith('/')) {
    const drive = /^\/([A-Za-z])(\/.*)?$/.exec(word);
    if (!drive) return null;
    word = `${drive[1].toUpperCase()}:${drive[2] ?? '/'}`;
  }
  return resolve(base, word.replace(/^~(?=[/\\]|$)/, homedir()));
}

// The directory a lone `git worktree add` creates, and the directory it runs in, or null.
function worktreeAddTarget(command, cwd, powershell) {
  if (!WORKTREE_ADD_HINT.test(command)) return null;
  const segments = command.trim().split('&&');
  let dir = cwd;
  for (let i = 0; i < segments.length && i < 2; i++) {
    if (UNCERTAIN.test(segments[i]) || /&/.test(segments[i])) return null;
    const tokens = words(segments[i], powershell);
    if (!tokens || !tokens.length) return null;
    if (i === 0 && tokens[0] === 'cd') {
      if (tokens.length !== 2) return null;
      dir = literalPath(dir, tokens[1]);
      if (!dir) return null;
      continue;
    }
    if (tokens[0] !== 'git') return null;
    let at = 1;
    for (; at < tokens.length && tokens[at].startsWith('-'); at++) {
      if (tokens[at] === '-C') { dir = literalPath(dir, tokens[++at]); if (!dir) return null; }
      else if (tokens[at] === '-c') at++;
      else if (/^--(?:git-dir|work-tree|namespace|super-prefix|config-env)/.test(tokens[at])) return null;
    }
    if (tokens[at] !== 'worktree' || tokens[at + 1] !== 'add') return null;
    const target = literalPath(dir, worktreeAddPositionals(tokens.slice(at + 2))[0]);
    return target ? { target, dir } : null;
  }
  return null;
}

/**
 * One advisory line for a `git worktree add` outside the host worktrees folder, or null.
 * @param {string} command @param {{ cwd: string, host?: string, env?: Record<string, string | undefined>, powershell?: boolean }} ctx
 */
export function adviseCommand(command, ctx) {
  try {
    if (typeof command !== 'string' || !isAbsolute(ctx.cwd)) return null;
    const found = worktreeAddTarget(command, ctx.cwd, Boolean(ctx.powershell));
    if (!found) return null;
    const layout = resolveLayout(found.dir, ctx.host ?? detectHost(ctx.env ?? process.env));
    if (!layout?.worktrees) return null;
    if (within(layout.worktrees, found.target) || within(realish(layout.worktrees), realish(found.target))) return null;
    const worktrees = fwd(layout.worktrees);
    const form = quoted(`${worktrees}/<topic>`);
    const setup = existsSync(join(layout.worktrees, '.gitignore')) ? '' : ` Run node "${fwd(SELF)}" ensure first so git ignores the folder.`;
    return `Workspace note: this git worktree add puts a worktree in ${fwd(dirname(found.target))}, outside ${quoted(worktrees)}. `
      + `Unless the user named that path, use git worktree add ${form} -b eng/<topic>; `
      + `without -b, git names the branch after the last path segment.${setup}`;
  } catch { return null; }
}

// ---- CLI -----------------------------------------------------------------------------------

function worktreeList(cwd) {
  const run = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8', timeout: 20000 });
  if (run.status !== 0) return null;
  return run.stdout.split(/\r?\n\r?\n/).map((block) => /^worktree (.+)$/m.exec(block)?.[1]).filter(Boolean).map((path) => resolve(path));
}

function hostManagedRoots(env) {
  return [join(env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), '.codex'), 'worktrees'), join(env.GROK_HOME ? resolve(env.GROK_HOME) : join(homedir(), '.grok'), 'worktrees')];
}

function check(layout, cwd, strict, env) {
  const list = worktreeList(cwd);
  if (!list) { console.error('workspace-layout: git worktree list failed'); return 2; }
  const layoutRoots = layout.mainTop ? Object.values(HOST_FOLDERS).map((folder) => join(layout.mainTop, folder, 'worktrees')) : [];
  const managed = hostManagedRoots(env);
  let problems = 0;
  for (const [index, path] of list.entries()) {
    // With no known main checkout there is no layout to measure against, so nothing counts as stray.
    const label = index === 0 ? 'main' : insideAny(layoutRoots, path) ? 'in-layout' : insideAny(managed, path) ? 'host-managed' : layout.mainTop ? 'stray' : 'unknown';
    if (label === 'stray') problems++;
    console.log(`${label.padEnd(13)} ${fwd(path)}`);
  }
  for (const dir of [layout.tmp, layout.worktrees].filter(Boolean)) {
    if (!existsSync(dir)) console.log(`not created   ${fwd(dir)} (run ensure)`);
    else if (!ignoresAll(dir)) { problems++; console.log(`no ignore     ${fwd(dir)} (run ensure, or add a * line to its .gitignore)`); }
  }
  return strict && problems ? 1 : 0;
}

function main(argv) {
  const [verb, ...rest] = argv;
  const flag = (name) => { const at = rest.indexOf(name); return at === -1 ? undefined : rest[at + 1]; };
  const positional = rest.filter((word, at) => !word.startsWith('--') && !['--host', '--cwd'].includes(rest[at - 1]));
  if (!['path', 'ensure', 'check'].includes(verb)) {
    console.error('usage: workspace-layout.mjs path [tmp|worktrees] | ensure | check [--strict]  [--host <h>] [--cwd <dir>]');
    return 2;
  }
  const host = flag('--host');
  if (host !== undefined && !Object.hasOwn(HOST_FOLDERS, host)) { console.error(`workspace-layout: unknown host ${host}; use ${Object.keys(HOST_FOLDERS).join(', ')}`); return 2; }
  const cwd = resolve(flag('--cwd') ?? process.cwd());
  const layout = resolveLayout(cwd, host ?? detectHost());
  if (!layout) { console.error(`workspace-layout: ${fwd(cwd)} is not inside a git repository`); return 2; }
  if (verb === 'check') return check(layout, cwd, rest.includes('--strict'), process.env);
  const which = positional[0];
  if (which !== undefined && which !== 'tmp' && which !== 'worktrees') { console.error('workspace-layout: path takes tmp or worktrees'); return 2; }
  if (verb === 'ensure') ensureLayout(layout);
  if (which && !layout[which]) { console.error('workspace-layout: the main checkout cannot be established, so there is no worktrees folder'); return 2; }
  if (which) console.log(fwd(layout[which]));
  else console.log(`tmp ${fwd(layout.tmp)}\nworktrees ${layout.worktrees ? fwd(layout.worktrees) : '(unknown: main checkout not found)'}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main(process.argv.slice(2));
