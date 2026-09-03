#!/usr/bin/env node
// PostToolUse hook on Edit, Write, MultiEdit, and NotebookEdit: re-indexes the one file the
// tool just changed, so `context-query.mjs` answers from the live tree without a daemon and a
// query never carries a stale banner for a file this session edited.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER. The hook does nothing when `CODE_OPS_INDEX` is
// `off`, `0`, or `false` (case-insensitive) in its environment, which the `env` block of a
// `.claude/settings.json` sets at user or repository scope. With the hook on, it runs
// `node <plugin>/scripts/context-query.mjs refresh <file>` with a five-second budget, in the
// tool's own working directory, and prints nothing. The index lives under
// `~/.claude/code-ops/index/<project slug>/` (or `$CODE_OPS_INDEX_DIR`), never in the tree.
//
// Fail-open on every path: bad JSON, another tool, a payload without a file path, a file
// outside a git work tree, a missing query script, a slow or failing refresh, or an internal
// error all exit 0 with no output. It never blocks a call and never writes to the tree.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function main() {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_INDEX ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return; }
  if (!EDIT_TOOLS.has(payload?.tool_name)) return;
  const file = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
  if (typeof file !== 'string' || !file.trim()) return;
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'context-query.mjs');
  if (!existsSync(script)) return;
  const cwd = typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : process.cwd();
  spawnSync(process.execPath, [script, 'refresh', file], { cwd, timeout: 5000, stdio: 'ignore' });
}

try { main(); } catch { /* fail open */ }
