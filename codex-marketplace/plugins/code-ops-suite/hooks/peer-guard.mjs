#!/usr/bin/env node
// PreToolUse hook: redirects a message to a peer session that already handed off to the live
// successor, or denies it when no live successor can take it. When several sessions coordinate, a
// sender kept messaging a peer whose handoff was already resumed by another session. The handoff
// skill says to run `co handoff live "<name>"` first; this hook is the mechanical backstop for
// that step.
//
// TOOLS. `mcp__ccd_session_mgmt__send_message` names its target in `session_id`, and
// `SendMessage` names it in `to`. Every other tool passes before any file is read, because the
// Codex projection drops matchers and runs this hook on every tool call.
//
// LOOKUP. sessionRecords() in scripts/handoff-state.mjs reads the session records for the
// repository the payload cwd belongs to: the repository-keyed store, which every worktree of the
// repository shares, then the older store keyed by the working directory. Both sit under env
// CODE_OPS_HOME when set, else the OS home. The target matches a record's `hostSessionId` (the
// desktop `local_<uuid>` id) or `sessionId` first, then its `name`, newest `updatedAt` first.
// Every comparison is case-insensitive and exact. A record's `runDir` is relative to its
// `worktree` under the repository root, or to cwd for an older record without one.
//
// DECISION. The hook acts only when the matched record's run folder holds HANDOFF.consumed or
// HANDOFF.md, because either means that session handed off. It walks successor links the way
// `live()` in scripts/handoff-state.mjs does. A live head that carries the id the tool needs (the
// host session id for `session_id`, the session name for `to`) yields a redirect: the hook
// returns `updatedInput`, the whole tool input with the target replaced by the head, and a
// notice in `additionalContext` naming the old target and the head. Like the digest rewrite hook,
// it returns no `permissionDecision`, so the host's own permission rules still decide the call.
// A live head without that id, or any head on a host whose input rewrite is unverified, yields
// a denial naming the head's session name, host session id when a record carries one, and run
// folder. A head with an unconsumed HANDOFF.md, the target itself included, yields a denial saying
// the handoff has not been resumed yet and naming the successor from its `Session:` line. A legacy
// marker, a loop, or a missing successor run yields a denial that asks the sender to run
// `co handoff live`. An unknown target, no record store, or a run folder with neither file passes
// silently. SendMessage's `to` may end in a ` [<ref>]` suffix, stripped before matching.
//
// SWITCH. On by default. `CODE_OPS_PEER_GUARD` of `off`, `0`, or `false` (case-insensitive)
// disables it, set in the host environment; rendered hosts use their
// documented process environment. The same switch turns off the presence board writes.
//
// HOST COVERAGE. Codex and Codex document `hookSpecificOutput.updatedInput` (CONFIRMED),
// so both get the redirect. Grok sends camelCase `toolName`, `toolInput`, and `sessionId`, which
// main() maps onto the snake_case keys, as hooks/dispatch-guard.mjs does. Grok is detected by
// GROK_PLUGIN_ROOT or that camelCase shape, and keeps the denial, because no live Grok payload
// has shown the rewrite taking effect (UNVERIFIED, OI-10). Neither Grok nor Codex is known to ship
// either messaging tool (UNVERIFIED). OpenCode does not run this hook.
//
// FAIL-OPEN on every path: bad JSON, a missing field, an unreadable store, or any thrown error
// exits 0 with no output. The hook reads at most two directories and a few small files, and never
// spawns a process.

import { existsSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TARGET_FIELD = new Map([
  ['mcp__ccd_session_mgmt__send_message', 'session_id'],
  ['SendMessage', 'to'],
  ['send_subagent_message', 'subagent_id'],
]);

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

// The successor run named by HANDOFF.consumed in `dir`: a string for a version 2 marker, null for
// a legacy marker, undefined when the folder holds none.
function successorRun(dir) {
  const file = join(dir, 'HANDOFF.consumed');
  if (!existsSync(file)) return undefined;
  const body = readJson(file);
  return body && body.v === 2 && typeof body.successorRun === 'string' && body.successorRun ? body.successorRun : null;
}

// The `Session:` value of a HANDOFF.md `## Program` section, parsed as handoff-state.mjs parses it.
function pendingName(file) {
  const program = /^##[ \t]+program[^\n]*\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
  return /^[-*\t ]*Session:[^\S\r\n]*(.*)$/m.exec(program)?.[1].trim().replace(/^`(.*)`$/, '$1').trim() || null;
}

// Walks successor links from a consumed run folder to the head of the chain. Successor paths are
// relative to `base`, the worktree top the chain lives in.
function walk(start, base) {
  const seen = new Set();
  let dir = start;
  for (;;) {
    seen.add(dir);
    const handoff = join(dir, 'HANDOFF.md');
    const next = successorRun(dir);
    if (next === undefined) {
      return existsSync(handoff) ? { dir, state: 'awaiting', handoff, pending: pendingName(handoff) } : { dir, state: 'live' };
    }
    if (next === null) return { dir, state: 'unknown', why: 'a legacy HANDOFF.consumed names no successor run' };
    const nextDir = resolve(base, next);
    if (seen.has(nextDir)) return { dir, state: 'unknown', why: `successor run ${next} loops back` };
    if (!existsSync(nextDir)) return { dir, state: 'unknown', why: `successor run ${next} is missing` };
    dir = nextDir;
  }
}

// { reason } for a denial, plus { redirect } when a live head carries the id `field` needs.
function decide(target, field, records, cwd, ident, recordBase) {
  const want = target.toLowerCase();
  const same = (v) => typeof v === 'string' && v.toLowerCase() === want;
  const newest = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt));
  const rec = records.find((r) => same(r.hostSessionId) || same(r.sessionId))
    ?? records.filter((r) => same(r.name)).sort(newest)[0];
  if (!rec) return null;
  const base = recordBase(rec, ident, cwd);
  const start = resolve(base, rec.runDir);
  if (successorRun(start) === undefined && !existsSync(join(start, 'HANDOFF.md'))) return null;

  const show = (p) => relative(cwd, p).replace(/\\/g, '/');
  const live = `\`co handoff live "${target}"\``;
  const head = walk(start, base);
  if (head.state === 'unknown') return { reason: `Peer guard: ${target} already handed off, and its successor could not be resolved: ${head.why}. Run ${live} before resending.` };
  if (head.state === 'awaiting') {
    return { reason: `Peer guard: ${target} already handed off, and the handoff has not been resumed yet, so its successor has not started: ${show(head.handoff)} is not consumed`
      + `${head.pending ? `; the successor takes the name ${head.pending}` : ''}. Hold the message until that session resumes the handoff, then run ${live} to find it.` };
  }
  const session = readJson(join(head.dir, 'SESSION.json')) ?? {};
  const headRec = records.filter((r) => resolve(recordBase(r, ident, cwd), r.runDir) === head.dir).sort(newest)[0] ?? {};
  const name = session.name ?? headRec.name ?? 'unknown';
  const hostId = headRec.hostSessionId ?? session.hostSessionId;
  const host = typeof hostId === 'string' && hostId ? `host session ${hostId}` : 'no host session id recorded';
  const where = `${name} (${host}) in ${show(head.dir)}`;
  const value = field === 'session_id' ? (typeof hostId === 'string' && hostId ? hostId : null) : (name !== 'unknown' ? name : null);
  return {
    reason: `Peer guard: ${target} already handed off and is finished. Its live successor is ${where}. Resend the message there.`,
    redirect: value && { value, notice: `Peer guard: ${target} already handed off and is finished, so this message was redirected to its live successor ${where}.` },
  };
}

async function main() {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_PEER_GUARD ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  if (payload.hook_event_name && payload.hook_event_name !== 'PreToolUse') return;
  const field = TARGET_FIELD.get(payload.tool_name ?? payload.toolName);
  const input = payload.tool_input ?? payload.toolInput;
  if (!field || !input || typeof input !== 'object') return;
  // SendMessage may append a ` [<ref>]` suffix to the name in `to`, which no record carries.
  const target = typeof input[field] === 'string' ? input[field].trim().replace(/ \[\S+\]$/, '') : '';
  if (!target) return;

  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'handoff-state.mjs');
  const { sessionRecords, recordBase } = await import(pathToFileURL(libPath).href);
  const { ident, records } = sessionRecords(cwd, process.env.CODE_OPS_HOME || homedir());
  if (!records.length) return;

  const result = decide(target, field, records, cwd, ident, recordBase);
  if (!result) return;
  const grok = Boolean(process.env.GROK_PLUGIN_ROOT) || (payload.tool_name === undefined && payload.toolName !== undefined);
  const out = result.redirect && !grok
    ? { hookEventName: 'PreToolUse', updatedInput: { ...input, [field]: result.redirect.value }, additionalContext: result.redirect.notice }
    : { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason };
  writeSync(1, `${JSON.stringify({ hookSpecificOutput: out })}\n`);
}

main().catch(() => { /* fail open */ });
