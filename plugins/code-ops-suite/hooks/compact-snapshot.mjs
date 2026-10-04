#!/usr/bin/env node
// PreCompact and PostCompact hook: writes COMPACT_SNAPSHOT.md around compaction, so the next
// tool result can point the lead at the operator words, running work, active items, and
// reply-owed peers the summary loses. The parsing, masking, budgets, and the write live in
// `../scripts/compact-snapshot.mjs` (createSnapshot); this hook only feeds it the payload.
// A written snapshot is marked pending beside the handoff marker. The handoff card names that
// file once, on the next tool result, and that line outranks the host summary.
//
// The host ignores PreCompact and PostCompact stdout, so the hook prints nothing. It never blocks
// compaction: every path, including a bad payload, a missing transcript, and a failed write, exits 0.
// The payload's `session_id`, `transcript_path`, and `cwd` are all it reads. Grok sends camelCase
// `sessionId` and `transcriptPath` as well.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER: the snapshot write does nothing when
// `CODE_OPS_COMPACT_SNAPSHOT` is `off`, `0`, or `false` (case-insensitive), the switch shape the
// other suite hooks use. On Grok that switch still leaves the ceiling-assessment write on, so a
// compact unlocks the price-line band. A payload with neither a session id nor a transcript path
// writes nothing, because the snapshot would belong to no session.
//
//   node hooks/compact-snapshot.mjs < payload.json

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const text = (value) => (typeof value === 'string' && value ? value : undefined);
const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// A Grok compact records the same ceiling assessment a typed /compact records, so the price-line
// block unlocks even when the host consumes the slash command before UserPromptSubmit. The
// snapshot switch does not gate this write. A missing context size records nothing.
async function recordCompactUnlock(payload, sessionId, transcriptPath, cwd) {
  const event = payload?.hook_event_name ?? payload?.hookEventName;
  if ((event !== 'PreCompact' && event !== 'PostCompact') || !process.env.GROK_PLUGIN_ROOT) return;
  try {
    const { residentContext, contextCeiling, recordCeilingAssessment } = await import(pathToFileURL(join(scripts, 'transcript-lib.mjs')).href);
    const context = residentContext(
      { ...payload, session_id: sessionId, transcript_path: transcriptPath, cwd },
      { grok: true, home: homedir() },
    );
    if (typeof context === 'number') recordCeilingAssessment(cwd, sessionId, context, contextCeiling(), homedir());
  } catch { /* a missed unlock leaves the typed /compact path */ }
}

async function main() {
  const snapshotOff = /^(off|0|false)$/i.test(process.env.CODE_OPS_COMPACT_SNAPSHOT ?? '');
  let raw = '';
  try { raw = readFileSync(0, 'utf8').replace(/^﻿/, ''); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  // Opt-in payload capture (`captureOn` in agent-ledger.mjs) records the key names, so a host's
  // PreCompact payload shape can be checked. The snapshot switch still skips it.
  if (!snapshotOff) {
    try {
      const { captureKeys } = await import(pathToFileURL(join(scripts, 'agent-ledger.mjs')).href);
      captureKeys(payload);
    } catch { /* capture never blocks the snapshot */ }
  }
  const sessionId = text(payload?.session_id) ?? text(payload?.sessionId);
  const transcriptPath = text(payload?.transcript_path) ?? text(payload?.transcriptPath);
  const cwd = text(payload?.cwd) ?? process.cwd();
  if (sessionId) await recordCompactUnlock(payload, sessionId, transcriptPath, cwd);
  if (snapshotOff || (!sessionId && !transcriptPath)) return;
  const { createSnapshot, markSnapshotRestore } = await import(pathToFileURL(join(scripts, 'compact-snapshot.mjs')).href);
  const snap = createSnapshot({ sessionId: sessionId ?? '', transcriptPath, cwd });
  if (sessionId && snap?.path) markSnapshotRestore({ sessionId, cwd, path: snap.path });
}

main().then(() => process.exit(0), () => process.exit(0));
