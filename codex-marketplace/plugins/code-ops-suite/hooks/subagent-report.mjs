#!/usr/bin/env node
// SubagentStop hook with two jobs for a suite subagent.
//
// 1. An advisory return validator. It checks the final report against the agent's own
//    `## Contract` block: the first non-empty line must start with one of the tokens on its
//    `Verdicts:` line, and the whole report must fit the body's `Report cap: at most N words`
//    line. A miss prints one `systemMessage` note for the operator.
//
// 2. A report saver, for a read-only agent only. A read-only agent has no file-write tool, so no
//    model could write its report to the brief's `Report path:`. The hook saves the final message
//    there, with one comment line first that names this hook and the agent type. An agent that can
//    write (`implementer`, `mech`, `verifier`) writes its own report, so it gets no save and a
//    skipped report stays visibly missing. `readOnly` decides: the agent file's frontmatter
//    `tools:` line when present (no Write and no Edit), else the frozen `READ_ONLY_AGENTS` set.
//    See `saveReport` for the path rules: the path must
//    be a `.md` file inside the repository, with no Windows-special segment (`:`, a trailing dot or
//    space, a device name), under a run-scratch location (`80 Runs` directly inside the docs hub
//    folder, or `<host folder>/.tmp`) that git ignores, and an existing non-empty file is never
//    touched.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER. The hook does nothing when
// `CODE_OPS_SUBAGENT_REPORT` is `off`, `0`, or `false` (case-insensitive) in its environment.
// `nosave` keeps the advisory and skips the save.
//
// NEVER BLOCKS. It never returns `decision: "block"`, never sets `continue`, and never writes
// `additionalContext`, so it cannot hold a subagent open or add a turn. Every path exits 0.
//
// Host contract (host 2.1.276 bundle, offset 203499373): the SubagentStop input carries
// `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`, the text blocks
// of the subagent's last assistant message joined by newlines, or absent when it had no text.
// When that field is absent the hook reads the last assistant text from the agent transcript.
// The universal output schema accepts `systemMessage` (196910085), which the host shows to the
// user and does not hand to the model.
//
// Only a plugin-qualified type from a suite plugin (`code-ops-suite:implementer`) whose agent
// file declares a contract is checked. A bare, custom, non-suite, or unresolvable type is
// unknown and gets nothing.
// Grok's SubagentStop uses camelCase `subagentType`, `lastAssistantMessage`, `agentTranscriptPath`,
// and `cwd`. The note is a `systemMessage` only. `additionalContext` on this event keeps the child
// working. Grok's transcript layout is UNVERIFIED: the save reads the brief from the first entry
// with the dispatch guard's own checks, and saves nothing when that entry does not match.
//
// Fail-open on every path: bad JSON, a missing field, an unreadable file, or an internal error
// exits 0 with no output, and a failed save never hides the advisory. It reads stdin and local
// files and imports builtins. Only a save that passes every other rule spawns a process, one
// `git check-ignore`, to prove git ignores the path.

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The agent file resolves exactly as the dispatch guard resolves it: a suite plugin's sibling
// checkout directory, or the highest all-numeric version directory in the host plugin cache.
import { agentFile } from './agent-file.mjs';

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

// A host distribution can strip the `tools:` frontmatter line, so the rule cannot rest on it alone.
// This set names the read-only suite agents for that case. An agent missing from it gets no save.
const READ_ONLY_AGENTS = new Set([
  'code-ops-suite:explorer', 'code-ops-suite:reviewer', 'code-ops-suite:probe', 'code-ops-suite:web-researcher',
  'code-ops-suite:mech-review', 'rigor:tracer', 'researcher:gatherer', 'researcher:claim-checker',
  'privacy-opsec-suite:explorer', 'privacy-opsec-suite:privacy-reviewer',
]);

// True when the agent has no file-write tool.
function readOnly(agentType, agentText) {
  const front = agentText.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const tools = front.match(/^tools:[ \t]*(.*)$/m)?.[1];
  if (tools !== undefined && tools.trim()) return !/\b(Write|Edit)\b/.test(tools);
  return READ_ONLY_AGENTS.has(agentType.trim());
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

const textField = (payload, ...keys) => {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

// The dispatch guard reads the brief from the first 256 KiB of the agent transcript.
const BRIEF_HEAD_BYTES = 262_144;
// The libraries this hook loads (agent-ledger.mjs, workspace-layout.mjs) sit in `scripts/` beside
// the hooks directory in every render that ships this hook, as the dispatch guard's own import does.
const SCRIPTS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts');

// The brief: the first user entry of the agent transcript, with the dispatch guard's own checks
// (`parseBrief`): a root user entry, and an `agentId`, when present, that matches this agent.
function briefText(payload) {
  const path = payload.agent_transcript_path ?? payload.agentTranscriptPath;
  if (typeof path !== 'string' || !path) return '';
  let fd;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(BRIEF_HEAD_BYTES);
    const text = buffer.subarray(0, readSync(fd, buffer, 0, BRIEF_HEAD_BYTES, 0)).toString('utf8');
    const entry = JSON.parse(text.split('\n', 1)[0]);
    if (entry?.type !== 'user' || entry.parentUuid !== null
      || (entry.agentId !== undefined && entry.agentId !== (payload.agent_id ?? payload.agentId))) return '';
    return textOf(entry.message?.content);
  } catch { return ''; } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* fail open */ }
  }
}

// `target` inside `root`, strictly: equal paths and `..` escapes are outside. Mirrors `within` in
// scripts/workspace-layout.mjs, which does not export it.
function inside(root, target) {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// The nearest existing ancestor of `path` resolved through symlinks and junctions, with the rest
// re-appended. Mirrors `realish` in scripts/workspace-layout.mjs.
function realish(path) {
  const tail = [];
  for (let dir = path; ;) {
    try { return join(realpathSync.native(dir), ...tail.reverse()); } catch { /* climb */ }
    const up = dirname(dir);
    if (up === dir) return path;
    tail.push(basename(dir));
    dir = up;
  }
}

// Git ignores `rel` under `top`. Only exit 0 proves it: a tracked file, a path git does not
// ignore, a missing git, and a timeout all refuse.
function gitIgnores(top, rel) {
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  const run = spawnSync('git', ['-C', top, 'check-ignore', '-q', '--', rel], { env, timeout: 5000, stdio: 'ignore', windowsHide: true });
  return run.status === 0;
}

// A path segment Windows resolves to something other than the named file: an alternate data stream
// or a device (`:`), a name it strips a trailing dot or space from, or a reserved device name with or
// without an extension. Refused on every platform so the hook behaves the same everywhere. `.` and
// `..` are path syntax, not names.
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:[. ].*)?$/i;
function windowsUnsafe(segment) {
  if (segment === '' || segment === '.' || segment === '..') return false;
  return segment.includes(':') || /[. ]$/.test(segment) || RESERVED_DEVICE.test(segment);
}

// The docs hub the repository actually uses: the top-level folder that holds
// `98 System/DOCS_MANIFEST.json`, the same marker scripts/legacy-paths-lib.mjs names. Run scratch
// (`80 Runs`) is accepted only directly inside it. A top-level folder without that manifest, such as
// `node_modules`, is no hub.
const isDocsHub = (top, folder) => existsSync(join(top, folder, '98 System', 'DOCS_MANIFEST.json'));

// Saves the subagent's final message to the brief's `Report path:` and returns the repository-
// relative path with forward slashes, or '' when any rule below refuses. Every refusal is silent.
//   - the working directory is absolute and inside a git repository (`top`);
//   - the path is a `.md` file; a relative path resolves against `top`, and `\` reads as `/`;
//   - no segment holds `:` (but the drive prefix of an absolute path), ends in a dot or space, or is a
//     reserved Windows device name (`windowsUnsafe`), checked on every platform;
//   - it resolves, through symlinks and junctions, strictly inside `top`, with no `.git` segment;
//   - it sits under a run-scratch location, and git must ignore it: `<hub>/80 Runs/` with the hub the
//     first segment (`isDocsHub`), or `<host folder>/.tmp` for any host folder;
//   - the file is absent or an empty regular file; a non-empty file is never overwritten.
async function saveReport(payload, agentType, report) {
  const cwd = payload.cwd;
  const message = report.replace(/\r\n?/g, '\n').trim();
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || !message) return '';
  const { reportPathOf } = await import(pathToFileURL(join(SCRIPTS, 'agent-ledger.mjs')).href);
  // The same `Report path:` reading the agent ledger uses: the path may hold spaces (`80 Runs`)
  // and ends at its extension, so a trailing note in parentheses is ignored.
  const named = reportPathOf(briefText(payload)).replace(/\\/g, '/');
  if (!/\.md$/i.test(named) || named.startsWith('~') || (/^[A-Za-z]:/.test(named) && process.platform !== 'win32')) return '';
  if (named.replace(/^[A-Za-z]:(?=\/)/, '').split('/').some(windowsUnsafe)) return '';
  const { HOST_FOLDERS, resolveLayout } = await import(pathToFileURL(join(SCRIPTS, 'workspace-layout.mjs')).href);
  const layout = resolveLayout(cwd, 'other');
  if (!layout) return '';
  const top = realpathSync.native(layout.top);
  const target = realish(resolve(layout.top, named));
  if (!inside(top, target)) return '';
  const parts = relative(top, target).split(sep);
  if (parts.some((part) => part.toLowerCase() === '.git' || windowsUnsafe(part))) return '';
  const rel = parts.join('/');
  const scratch = parts.length > 2 && Object.values(HOST_FOLDERS).includes(parts[0]) && parts[1] === '.tmp';
  const runs = parts.length > 2 && parts[1] === '80 Runs' && isDocsHub(top, parts[0]);
  if (!(scratch || runs) || !gitIgnores(top, rel)) return '';
  let existing = null;
  try { existing = lstatSync(target); } catch { /* absent */ }
  if (existing && (!existing.isFile() || existing.size > 0)) return '';
  mkdirSync(dirname(target), { recursive: true });
  if (!inside(top, realpathSync.native(dirname(target)))) return '';
  writeFileSync(target, `<!-- saved by the subagent-report hook from ${agentType}'s final message -->\n${message}\n`, { flag: existing ? 'w' : 'wx' });
  return rel;
}

async function main() {
  const mode = (process.env.CODE_OPS_SUBAGENT_REPORT ?? '').toLowerCase();
  if (/^(off|0|false)$/.test(mode)) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  const event = payload.hook_event_name ?? payload.hookEventName;
  if (event && event !== 'SubagentStop' && event !== 'subagent_stop') return;
  const agentType = textField(payload, 'agent_type', 'subagentType', 'agentType');
  const file = agentFile(agentType);
  if (!file) return;
  const agentText = readFileSync(file, 'utf8');
  const contract = contractOf(agentText);
  if (!contract.verdicts.length && contract.cap === null) return;
  const report = textField(payload, 'last_assistant_message', 'lastAssistantMessage')
    || lastAssistantText(payload.agent_transcript_path ?? payload.agentTranscriptPath);
  if (!report) return;
  const type = agentType.trim();
  let saved = '';
  if (mode !== 'nosave' && readOnly(agentType, agentText)) {
    try { saved = await saveReport(payload, type, report); } catch { /* fail open: no save, the advisory still runs */ }
  }
  const problems = check(report, contract);
  const notes = [
    saved && `code-ops saved the ${type} report to ${saved}.`,
    problems.length && `code-ops return check (${type}): ${problems.join('; ')}. Advisory only; the lead decides whether to accept the report.`,
  ].filter(Boolean);
  if (notes.length) writeSync(1, `${JSON.stringify({ systemMessage: notes.join(' ') })}\n`);
}

main().catch(() => { /* fail open */ });
