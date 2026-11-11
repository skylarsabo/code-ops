#!/usr/bin/env node
// SessionStart hook: hands the Claude session lead the lead-only doctrine of the user-wide
// contract. scripts/render-global-contracts.mjs splits the Claude render in two: the core stays in
// global-contracts/AGENTS.claude.md, and the `audience: lead` text goes to lead-doctrine.claude.md
// beside this file. Without this hook the lead never reads that text.
//
// Host contract: like routing-card.mjs, it prints plain text, which Claude Code adds to the session
// context at SessionStart. hooks.json registers it with no matcher, so it fires on startup, resume,
// clear, and compact. A subagent never gets SessionStart context, so only the lead reads it.
//
// Claude only, live payload only. It prints when `CLAUDECODE` is `1` and stdin holds a payload.
// Grok (`GROK_PLUGIN_ROOT`) discards SessionStart stdout and keeps the full contract in its own
// file, as does Codex. The OpenCode build runs routing-card.mjs with empty stdin to bake its card,
// and it never runs this hook.
//
// NO OFF SWITCH: the doctrine is part of the contract, not an optional mechanism. Fail visible: a
// missing, unreadable, or empty doctrine file prints one line that names the gap and the fix, and
// every path exits 0 so the session still starts.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEAD_FILE = join(dirname(fileURLToPath(import.meta.url)), 'lead-doctrine.claude.md');
const MISSING = 'code-ops lead doctrine is missing (hooks/lead-doctrine.claude.md): the lead runs without its orchestration rules; reinstall or update the code-ops-suite plugin.';

function main() {
  if (process.env.GROK_PLUGIN_ROOT || process.env.CLAUDECODE !== '1') return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  if (!raw.trim()) return;
  let text = '';
  try { text = readFileSync(LEAD_FILE, 'utf8').replace(/^﻿/, '').trim(); } catch { /* reported below */ }
  process.stdout.write(`${text || MISSING}\n`);
}

try { main(); } catch { /* exit 0 so the session still starts */ }
