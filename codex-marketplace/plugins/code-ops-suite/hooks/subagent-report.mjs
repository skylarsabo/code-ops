#!/usr/bin/env node
// SubagentStop hook: an advisory return validator for a suite subagent. It checks the final
// report against the agent's own `## Contract` block: the first non-empty line must start with
// one of the tokens on its `Verdicts:` line, and the whole report must fit the body's
// `Report cap: at most N words` line. A miss prints one `systemMessage` note for the operator.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER. The hook does nothing when
// `CODE_OPS_SUBAGENT_REPORT` is `off`, `0`, or `false` (case-insensitive) in its environment.
//
// ADVISORY ONLY. It never returns `decision: "block"`, never sets `continue`, and never writes
// `additionalContext`, so it cannot hold a subagent open or add a turn. Every path exits 0.
//
// Host contract (host 2.1.276 bundle, offset 203499373): the SubagentStop input carries
// `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`, the text blocks
// of the subagent's last assistant message joined by newlines, or absent when it had no text.
// When that field is absent the hook reads the last assistant text from the agent transcript.
// The universal output schema accepts `systemMessage` (196910085), which the host shows to the
// user and does not hand to the model.
//
// Only a plugin-qualified type (`code-ops-suite:implementer`) whose agent file declares a
// contract is checked. A bare, custom, or unresolvable type is unknown and gets nothing. The
// Grok adapter's SubagentStop payload is UNVERIFIED, so the hook stays silent under Grok.
//
// Fail-open on every path: bad JSON, a missing field, an unreadable file, or an internal error
// exits 0 with no output. It reads stdin and local files, imports builtins, and spawns nothing.

import { existsSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITE_ROOT = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_NAME = /^[A-Za-z0-9][\w.-]*$/;

// The agent file for `plugin:name`. The suite's own agents live under its root. A sibling
// plugin sits beside it in a checkout (`plugins/<plugin>`) and one level up, under a version
// directory, in the host plugin cache (`<marketplace>/<plugin>/<version>`).
function agentFile(agentType) {
  if (typeof agentType !== 'string') return null;
  const parts = agentType.trim().split(':');
  if (parts.length !== 2 || !parts.every((p) => SAFE_NAME.test(p))) return null;
  const [plugin, name] = parts;
  const leaf = join('agents', `${name}.md`);
  const candidates = [join(SUITE_ROOT, '..', plugin, leaf)];
  if (plugin === 'code-ops-suite') candidates.unshift(join(SUITE_ROOT, leaf));
  const cached = join(SUITE_ROOT, '..', '..', plugin);
  if (existsSync(cached)) {
    const versions = readdirSync(cached).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    candidates.push(...versions.map((v) => join(cached, v, leaf)));
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

function contractOf(text) {
  const section = text.match(/^## Contract[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? '';
  const verdicts = section.match(/^Verdicts:[ \t]*(.+)$/m)?.[1].split('|').map((t) => t.trim()).filter(Boolean) ?? [];
  const cap = Number(text.match(/^Report cap: at most (\d+) words/m)?.[1]);
  return { verdicts, cap: Number.isInteger(cap) && cap > 0 ? cap : null };
}

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
    : '');

// The last assistant message with text in a JSONL transcript, mirroring the host's own field.
function lastAssistantText(path) {
  if (typeof path !== 'string' || !path || !existsSync(path)) return '';
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let row;
    try { row = JSON.parse(lines[i]); } catch { continue; }
    if (row?.type !== 'assistant') continue;
    const text = textOf(row.message?.content).trim();
    if (text) return text;
  }
  return '';
}

const startsWithToken = (line, token) => line.startsWith(token) && !/[\w-]/.test(line.charAt(token.length));

function check(report, contract) {
  const problems = [];
  const first = report.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (contract.verdicts.length && !contract.verdicts.some((t) => startsWithToken(first, t))) {
    problems.push(`the first line does not start with a declared verdict (${contract.verdicts.join(' | ')})`);
  }
  const words = report.split(/\s+/).filter(Boolean).length;
  if (contract.cap !== null && words > contract.cap) {
    problems.push(`the report is ${words} words, over its ${contract.cap}-word cap`);
  }
  return problems;
}

function main() {
  if (process.env.GROK_PLUGIN_ROOT) return;
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_SUBAGENT_REPORT ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  if (payload.hook_event_name && payload.hook_event_name !== 'SubagentStop') return;
  const file = agentFile(payload.agent_type);
  if (!file) return;
  const contract = contractOf(readFileSync(file, 'utf8'));
  if (!contract.verdicts.length && contract.cap === null) return;
  const report = (typeof payload.last_assistant_message === 'string' && payload.last_assistant_message.trim())
    || lastAssistantText(payload.agent_transcript_path);
  if (!report) return;
  const problems = check(report, contract);
  if (!problems.length) return;
  const message = `code-ops return check (${payload.agent_type.trim()}): ${problems.join('; ')}. Advisory only; the lead decides whether to accept the report.`;
  writeSync(1, `${JSON.stringify({ systemMessage: message })}\n`);
}

try { main(); } catch { /* fail open */ }
