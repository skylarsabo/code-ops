#!/usr/bin/env node
// PreCompact hook: writes COMPACT_SNAPSHOT.md before the host compacts, so the SessionStart compact
// card can point the lead at the operator words, running work, active items, and reply-owed peers
// the summary loses. The parsing, masking, budgets, and the write live in
// `../scripts/compact-snapshot.mjs` (createSnapshot); this hook only feeds it the payload.
//
// The host ignores PreCompact stdout, so the hook prints nothing. It never blocks compaction: every
// path, including a bad payload, a missing transcript, and a failed write, exits 0. The payload's
// `session_id`, `transcript_path`, and `cwd` are all it reads.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER: the hook does nothing when `CODE_OPS_COMPACT_SNAPSHOT`
// is `off`, `0`, or `false` (case-insensitive), the switch shape the other suite hooks use. A
// payload with neither a session id nor a transcript path writes nothing, because the snapshot
// would belong to no session.
//
//   node hooks/compact-snapshot.mjs < payload.json

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const text = (value) => (typeof value === 'string' && value ? value : undefined);
const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

async function main() {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_COMPACT_SNAPSHOT ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8').replace(/^﻿/, ''); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  // Opt-in payload capture (`captureOn` in agent-ledger.mjs) records the key names, so a host's
  // PreCompact payload shape can be checked; it runs before every early return and never fails the hook.
  try {
    const { captureKeys } = await import(pathToFileURL(join(scripts, 'agent-ledger.mjs')).href);
    captureKeys(payload);
  } catch { /* capture never blocks the snapshot */ }
  const sessionId = text(payload?.session_id);
  const transcriptPath = text(payload?.transcript_path);
  if (!sessionId && !transcriptPath) return;
  const { createSnapshot } = await import(pathToFileURL(join(scripts, 'compact-snapshot.mjs')).href);
  createSnapshot({ sessionId: sessionId ?? '', transcriptPath, cwd: text(payload?.cwd) ?? process.cwd() });
}

main().then(() => process.exit(0), () => process.exit(0));
