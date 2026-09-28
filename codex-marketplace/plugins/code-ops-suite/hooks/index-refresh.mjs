#!/usr/bin/env node
// PostToolUse hook on Edit, Write, MultiEdit, and NotebookEdit: re-indexes the one file the
// tool just changed, so `context-query.mjs` answers from the live tree without a daemon and a
// query never carries a stale banner for a file this session edited.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER. The hook does nothing when `CODE_OPS_INDEX` is
// `off`, `0`, or `false` (case-insensitive) in its environment, which the `env` block of a
// the host environment supplies at user or repository scope. With the hook on, it runs
// `node <plugin>/scripts/context-query.mjs refresh <file>` with a five-second budget, in the
// tool's own working directory, and prints nothing. The index lives under
// `~/.codex/code-ops/index/<project slug>/` (or `$CODE_OPS_INDEX_DIR`), never in the tree.
//
// PRESENCE BOARD. The same call records the edited paths, relative to the worktree top, as recent
// edits on this session's presence board record through updateBoard() in
// scripts/handoff-state.mjs, which also refreshes the heartbeat. It needs the payload's session
// id, writes only under `<home>/.claude/code-ops/board/`, and is off when `CODE_OPS_PEER_GUARD` is
// `off`, `0`, or `false`, independent of `CODE_OPS_INDEX`. A path outside the worktree is skipped.
//
// Fail-open on every path: bad JSON, another tool, a payload without a file path, a file
// outside a git work tree, a missing query script, a slow or failing refresh, or an internal
// error all exit 0 with no output. It never blocks a call and never writes to the tree.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EDIT_TOOLS = new Set(['edit', 'write', 'search_replace', 'multiedit', 'notebookedit', 'apply_patch', 'functions.apply_patch']);

function editedFiles(payload) {
  const name = String(payload?.tool_name ?? payload?.toolName ?? payload?.tool?.name ?? '').toLowerCase();
  if (![...EDIT_TOOLS].some((tool) => name === tool || name.endsWith(`.${tool}`))) return [];
  const input = payload?.tool_input ?? payload?.toolInput ?? payload?.input;
  const direct = input?.file_path ?? input?.filePath ?? input?.notebook_path ?? input?.path;
  if (typeof direct === 'string' && direct.trim()) return [direct];
  const patch = input?.patch ?? input?.input;
  if (typeof patch !== 'string') return [];
  return [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map((match) => match[1].trim());
}

const off = (name) => /^(off|0|false)$/i.test(process.env[name] ?? '');

async function main() {
  const indexOn = !off('CODE_OPS_INDEX');
  const boardOn = !off('CODE_OPS_PEER_GUARD');
  if (!indexOn && !boardOn) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return; }
  const files = [...new Set(editedFiles(payload))];
  if (!files.length) return;
  const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
  const cwd = typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : process.cwd();
  const sid = payload.session_id ?? payload.sessionId;
  if (boardOn && typeof sid === 'string' && sid) {
    try {
      const { updateBoard, boardEdits } = await import(pathToFileURL(join(scripts, 'handoff-state.mjs')).href);
      updateBoard(cwd, sid, boardEdits(files), process.env.CODE_OPS_HOME || homedir());
    } catch { /* the board is advisory */ }
  }
  const script = join(scripts, 'context-query.mjs');
  if (!indexOn || !existsSync(script)) return;
  for (const file of files) spawnSync(process.execPath, [script, 'refresh', file], { cwd, timeout: 5000, stdio: 'ignore' });
}

main().catch(() => { /* fail open */ });
