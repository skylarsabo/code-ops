#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/subagent-report.mjs, the advisory
// SubagentStop return validator. It pins the contract the hook promises:
//   - pass: a report whose first line starts with a declared verdict and fits the cap gets nothing;
//   - wrong verdict: a first line without a declared token gets one systemMessage that names the
//     declared tokens, and a token prefix such as NOT-CONFIRMED does not satisfy CONFIRMED;
//   - over cap: a report past the agent's `Report cap` words gets one systemMessage with the count;
//   - transcript fallback: with no last_assistant_message, the last assistant text in
//     agent_transcript_path is checked;
//   - unknown agent: a bare, custom, traversal, or missing type gets nothing;
//   - cache layout: only the highest all-numeric version directory of a sibling plugin binds;
//   - malformed payload: bad JSON, an empty input, a non-object, and another event exit 0 silently;
//   - never blocks: no output carries decision, continue, or additionalContext, and every run
//     exits 0; the off switch and the Grok adapter silence it;
//   - report save: the final message lands at the brief's `Report path:` only when the path is a
//     `.md` file inside the repository under `80 Runs` (git-ignored) or `<host folder>/.tmp`, and
//     the file is absent or empty. Every other path, a missing brief, and `off` or `nosave` save
//     nothing, and a non-empty file is never overwritten. Each case runs in a temp git repository;
//   - read-only rule: only an agent with no Write and no Edit tool gets a save. The agent file's
//     `tools:` line decides; with that line absent, a frozen set of the ten read-only suite agents
//     decides. A write-capable agent gets no save, so a skipped report stays missing.
//
//   node evals/subagent-report/run.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';
import { HOST_FOLDERS } from '../../scripts/workspace-layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const suite = join(root, 'plugins', 'code-ops-suite');
const hook = join(suite, 'hooks', 'subagent-report.mjs');
const { fails, expect } = tally();

function runHook(input, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: suite };
  delete env.GROK_PLUGIN_ROOT;
  delete env.CODE_OPS_SUBAGENT_REPORT;
  Object.assign(env, extraEnv);
  return spawnSync('node', [hook], { input, encoding: 'utf8', env });
}
const payload = (type, message, extra = {}) => JSON.stringify({
  hook_event_name: 'SubagentStop', session_id: 's1', stop_hook_active: false, agent_id: 'a1', agent_type: type,
  ...(message === undefined ? {} : { last_assistant_message: message }), ...extra,
});
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
function note(r, label) {
  expect(r.status === 0, `${label}: must exit 0, got ${r.status}`);
  let out;
  try { out = JSON.parse(r.stdout); } catch { fails.push(`${label}: expected one JSON line, got ${JSON.stringify(r.stdout)}`); return ''; }
  expect(r.stdout.trim().split('\n').length === 1, `${label}: exactly one output line`);
  for (const k of ['decision', 'continue', 'hookSpecificOutput', 'stopReason']) expect(!Object.hasOwn(out, k), `${label}: output must not carry ${k}`);
  expect(typeof out.systemMessage === 'string' && out.systemMessage.length > 0, `${label}: output must be a systemMessage`);
  return out.systemMessage ?? '';
}
const silent = (r, label) => expect(r.status === 0 && r.stdout === '', `${label}: must exit 0 with no output, got ${r.status}/${JSON.stringify(r.stdout)}`);

// ---------------------------------------------------------------- pass
const passing = [
  ['code-ops-suite:implementer', 'DONE: D-002.md, 3 files changed\nNext: lead runs the gate chain'],
  ['code-ops-suite:implementer', '\n  CHECKPOINT: 40 rounds used\nNext: continue'],
  ['code-ops-suite:mech', 'PASS\nall gates green'],
  ['code-ops-suite:reviewer', 'CHANGES: two findings'],
  ['rigor:verifier', 'NOT-CONFIRMED: the repro did not fail'],
  ['researcher:gatherer', 'ANSWERED - three sources'],
  ['privacy-opsec-suite:privacy-reviewer', `APPROVE ${words(598)}`],
];
for (const [type, msg] of passing) silent(runHook(payload(type, msg)), `pass ${type}`);
console.log(`ok   ${passing.length} conforming reports across four plugins get nothing`);

// ---------------------------------------------------------------- wrong verdict
const wrong = [
  ['code-ops-suite:implementer', 'Done. I changed three files.', 'DONE | CHECKPOINT | BLOCKED'],
  ['code-ops-suite:implementer', 'DONEISH: close enough', 'DONE | CHECKPOINT | BLOCKED'],
  ['code-ops-suite:mech', '**PASS**', 'PASS | FAIL | ESCALATE'],
  ['rigor:verifier', 'NOT-CONFIRMED-YET', 'CONFIRMED | NOT-CONFIRMED | ESCALATE'],
  ['code-ops-suite:explorer', 'Here is what I found:\nANSWERED', 'ANSWERED | PARTIAL | ESCALATE'],
];
for (const [type, msg, tokens] of wrong) {
  const m = note(runHook(payload(type, msg)), `wrong verdict ${type} ${JSON.stringify(msg)}`);
  expect(m.includes('declared verdict') && m.includes(tokens) && m.includes(type), `wrong verdict ${type}: message names the type and tokens, got ${JSON.stringify(m)}`);
  expect(!/cap/.test(m), `wrong verdict ${type}: a short report must not be flagged over cap`);
}
console.log(`ok   ${wrong.length} reports without a declared first-line verdict get one advisory note`);

// ---------------------------------------------------------------- over cap
const over = [
  ['code-ops-suite:implementer', 600], ['code-ops-suite:mech', 300], ['code-ops-suite:explorer', 400], ['rigor:tracer', 400],
];
for (const [type, cap] of over) {
  const token = { 'code-ops-suite:implementer': 'DONE', 'code-ops-suite:mech': 'PASS', 'code-ops-suite:explorer': 'ANSWERED', 'rigor:tracer': 'TRACED' }[type];
  silent(runHook(payload(type, `${token} ${words(cap - 1)}`)), `at cap ${type}`);
  const m = note(runHook(payload(type, `${token} ${words(cap)}`)), `over cap ${type}`);
  expect(m.includes(`${cap + 1} words`) && m.includes(`${cap}-word cap`) && !m.includes('declared verdict'), `over cap ${type}: message names count and cap only, got ${JSON.stringify(m)}`);
}
const both = note(runHook(payload('code-ops-suite:mech', `Report follows ${words(400)}`)), 'wrong verdict and over cap');
expect(both.includes('declared verdict') && both.includes('300-word cap'), 'both problems land in one note');
console.log(`ok   ${over.length} agents: the cap boundary is exact, and both problems share one note`);

// ---------------------------------------------------------------- transcript fallback
const dir = mkdtempSync(join(tmpdir(), 'subagent-report-'));
const transcript = join(dir, 'agent-a1.jsonl');
writeFileSync(transcript, [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'brief' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: earlier' }] } }),
  '{torn line',
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All finished.' }, { type: 'tool_use', id: 't', name: 'x', input: {} }] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'x', input: {} }] } }),
  '',
].join('\n'));
const fb = note(runHook(payload('code-ops-suite:implementer', undefined, { agent_transcript_path: transcript })), 'transcript fallback');
expect(fb.includes('declared verdict'), 'transcript fallback checks the last assistant text, not an earlier message');
silent(runHook(payload('code-ops-suite:implementer', '', { agent_transcript_path: join(dir, 'missing.jsonl') })), 'missing transcript');
console.log('ok   an absent last_assistant_message falls back to the agent transcript; a missing transcript is silent');

// ---------------------------------------------------------------- unknown agent
for (const type of ['implementer', 'general-purpose', 'acme:builder', 'code-ops-suite:no-such-agent', 'code-ops-suite:../agents/implementer', '../x:implementer', 'a:b:c', 7, '', undefined]) {
  silent(runHook(payload(type, 'nonsense first line')), `unknown agent ${JSON.stringify(type)}`);
}
console.log('ok   bare, custom, traversal, missing, and non-string types get nothing');

// ---------------------------------------------------------------- cache layout
// The installed cache keeps a sibling plugin at <marketplace>/<plugin>/<version>/. Only an
// all-numeric version directory counts and the highest one wins (10.0.0 over 9.0.0, which a
// string sort would pick), the same resolution the dispatch guard uses.
const cache = join(dir, 'cache', 'code-ops');
const cacheAgent = (plugin, version, name, verdicts) => {
  mkdirSync(join(cache, plugin, version, 'agents'), { recursive: true });
  writeFileSync(join(cache, plugin, version, 'agents', `${name}.md`), `## Contract\n\nVerdicts: ${verdicts}\n`);
};
cacheAgent('code-ops-suite', '2.0.0', 'implementer', 'DONE');
cacheAgent('rigor', '9.0.0', 'tracer', 'OLD');
cacheAgent('rigor', '10.0.0', 'tracer', 'NEW');
cacheAgent('rigor', 'zzz-latest', 'tracer', 'STRAY');
const cacheRoot = { CLAUDE_PLUGIN_ROOT: join(cache, 'code-ops-suite', '2.0.0') };
silent(runHook(payload('rigor:tracer', 'NEW: resolved'), cacheRoot), 'cache highest numeric version');
for (const stale of ['OLD: stale', 'STRAY: non-numeric']) {
  const m = note(runHook(payload('rigor:tracer', stale), cacheRoot), `cache ${stale}`);
  expect(m.includes('(NEW)'), `cache: only rigor 10.0.0 binds, got ${JSON.stringify(m)}`);
}
silent(runHook(payload('code-ops-suite:implementer', 'DONE'), cacheRoot), 'cache own plugin');
console.log('ok   the cache layout resolves the highest all-numeric version and ignores other directories');

// ---------------------------------------------------------------- malformed payload
const malformed = [
  ['bad JSON', '{not json'],
  ['empty input', ''],
  ['JSON null', 'null'],
  ['JSON array', '[1,2]'],
  ['another event', JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'code-ops-suite:implementer', last_assistant_message: 'nope' })],
  ['non-string message', JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'code-ops-suite:implementer', last_assistant_message: { a: 1 }, agent_transcript_path: 5 })],
  ['blank message', payload('code-ops-suite:implementer', '   ')],
];
for (const [name, input] of malformed) silent(runHook(input), `malformed ${name}`);
const bom = runHook(`﻿${payload('code-ops-suite:implementer', 'nope')}`);
expect(/systemMessage/.test(bom.stdout), 'a BOM-prefixed payload is still read');
console.log(`ok   ${malformed.length} malformed payloads fail open; a BOM-prefixed payload is read`);

// ---------------------------------------------------------------- switches
for (const sw of ['off', '0', 'false', 'OFF']) silent(runHook(payload('code-ops-suite:implementer', 'nope'), { CODE_OPS_SUBAGENT_REPORT: sw }), `switch ${sw}`);
for (const sw of ['on', '1', '']) note(runHook(payload('code-ops-suite:implementer', 'nope'), { CODE_OPS_SUBAGENT_REPORT: sw }), `switch ${JSON.stringify(sw)}`);
note(runHook(payload('code-ops-suite:implementer', 'nope'), { GROK_PLUGIN_ROOT: suite }), 'Grok adapter');
silent(runHook(payload('code-ops-suite:implementer', 'DONE: D-002.md\nNext: lead runs the gate chain'), { GROK_PLUGIN_ROOT: suite }), 'Grok conforming report');
note(runHook(JSON.stringify({ hookEventName: 'subagent_stop', sessionId: 's1', subagentType: 'code-ops-suite:implementer', lastAssistantMessage: 'nope' }), { GROK_PLUGIN_ROOT: suite }), 'Grok camelCase stop');
console.log('ok   off, 0, and false silence the hook; other values leave it on; Grok notes a bad report and stays silent for a conforming one');

// ---------------------------------------------------------------- report save
// Each case runs against a temp git repository with two docs hubs (a folder holding
// `98 System/DOCS_MANIFEST.json`: `code-ops-docs` and `acme-docs`). Its `.gitignore` covers each hub's
// run folder and every host `.tmp`, all anchored, so `scripts/80 Runs/` and a top-level `80 Runs/` are
// not ignored. It also ignores places the hub rule must still refuse: `node_modules/`, `x/`, a nested
// `code-ops-docs/x/`, and `other-docs/80 Runs/` (a folder with no manifest).
const gitRun = (cwd, ...args) => spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'ignore' });
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-report-repo-')));
const outside = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-report-out-')));
// A repository whose host `.tmp` folders git does NOT ignore.
const bare = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-report-bare-')));
gitRun(repo, 'init', '-q');
gitRun(bare, 'init', '-q');
writeFileSync(join(repo, '.gitignore'), [
  '/code-ops-docs/80 Runs/', '/acme-docs/80 Runs/', '/other-docs/80 Runs/', '/node_modules/', '/x/', '/code-ops-docs/x/',
  ...Object.values(HOST_FOLDERS).map((folder) => `/${folder}/.tmp/`),
].join('\n') + '\n');
for (const hubFolder of ['code-ops-docs', 'acme-docs']) {
  mkdirSync(join(repo, hubFolder, '98 System'), { recursive: true });
  writeFileSync(join(repo, hubFolder, '98 System', 'DOCS_MANIFEST.json'), '{}\n');
}
mkdirSync(join(repo, 'src'), { recursive: true });
const GOOD = 'ANSWERED: the hook works\nNext: lead reads it';
let seq = 0;
// Runs the hook for an explorer whose brief carries `briefLine`; returns the result and the saved path.
function runSave(briefLine, { message = GOOD, cwd = repo, env = {}, entry = {}, input = {}, type = 'code-ops-suite:explorer' } = {}) {
  const transcriptFile = join(dir, `save-${++seq}.jsonl`);
  const brief = ['Scope: one file.', 'Objective: check.', briefLine, 'Expected return: verdict.'].filter((l) => l !== null).join('\n');
  writeFileSync(transcriptFile, `${JSON.stringify({ type: 'user', parentUuid: null, agentId: 'a1', message: { role: 'user', content: brief }, ...entry })}\n`);
  return runHook(payload(type, message, { cwd, agent_transcript_path: transcriptFile, ...input }), env);
}
const at = (...parts) => join(repo, ...parts);
const HUB_LINE = 'Report path: code-ops-docs/80 Runs/model-ladder-fable-5-2-2026-11-09/reports/D-014.md (write it)';
const HUB_FILE = at('code-ops-docs', '80 Runs', 'model-ladder-fable-5-2-2026-11-09', 'reports', 'D-014.md');

// saves into the hub run folder, the brief's own path with spaces and a trailing note
const hub = runSave(HUB_LINE, { message: 'ANSWERED: crlf\r\nline two\r\n\r\n' });
const hubNote = note(hub, 'save hub');
expect(hubNote.includes('code-ops-docs/80 Runs/model-ladder-fable-5-2-2026-11-09/reports/D-014.md') && !/return check/.test(hubNote), `save hub: one short line naming the relative path, got ${JSON.stringify(hubNote)}`);
const hubText = existsSync(HUB_FILE) ? readFileSync(HUB_FILE, 'utf8') : '';
expect(hubText === "<!-- saved by the subagent-report hook from code-ops-suite:explorer's final message -->\nANSWERED: crlf\nline two\n", `save hub: header, LF text, one final newline, got ${JSON.stringify(hubText)}`);
// saves into a host scratch folder, for every host folder, the path on a list line
for (const scratch of Object.values(HOST_FOLDERS).map((folder) => `${folder}/.tmp`)) {
  const file = at(...scratch.split('/'), 'run', 'r.md');
  note(runSave(`- Report path: ${scratch}/run/r.md`), `save ${scratch}`);
  expect(existsSync(file) && readFileSync(file, 'utf8').includes('ANSWERED: the hook works'), `save ${scratch}: file written`);
}
// a backslash path and a subdirectory working directory resolve against the repository top
note(runSave('Report path: code-ops-docs\\80 Runs\\back\\r.md', { cwd: at('src') }), 'save backslash from subdirectory');
expect(existsSync(at('code-ops-docs', '80 Runs', 'back', 'r.md')), 'save backslash from subdirectory: file written under the repository top');
// an absolute path inside the repository
const abs = at('code-ops-docs', '80 Runs', 'abs', 'r.md');
note(runSave(`Report path: ${abs}`), 'save absolute');
expect(existsSync(abs), 'save absolute: file written');

// refuses everything else, silently, with nothing written
const refused = [
  ['absolute path elsewhere', `Report path: ${join(outside, '80 Runs', 'x.md')}`, join(outside, '80 Runs', 'x.md')],
  ['dot-dot escape', 'Report path: code-ops-docs/80 Runs/../../../escape/80 Runs/x.md', join(dirname(repo), 'escape', '80 Runs', 'x.md')],
  ['non-md file', 'Report path: code-ops-docs/80 Runs/r/x.txt', at('code-ops-docs', '80 Runs', 'r', 'x.txt')],
  ['tracked-source location', 'Report path: scripts/x.md', at('scripts', 'x.md')],
  ['hub-named folder git does not ignore', 'Report path: scripts/80 Runs/x.md', at('scripts', '80 Runs', 'x.md')],
  ['top-level run folder git does not ignore', 'Report path: 80 Runs/x.md', at('80 Runs', 'x.md')],
  ['host folder outside .tmp', 'Report path: .claude/x.md', at('.claude', 'x.md')],
  ['inside .git', 'Report path: .git/80 Runs/x.md', at('.git', '80 Runs', 'x.md')],
  ['home-relative path', 'Report path: ~/80 Runs/x.md', at('~', '80 Runs', 'x.md')],
];
for (const [name, line, file] of refused) {
  silent(runSave(line), `refuse ${name}`);
  expect(!existsSync(file), `refuse ${name}: nothing may be written at ${file}`);
}
// the hub rule: `80 Runs` counts only directly inside a docs hub (a top-level folder with a manifest),
// whatever else git ignores; another adopted repository's own hub name works the same way
const listing = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.git')
  .flatMap((e) => (e.isDirectory() ? [`${prefix}${e.name}/`, ...listing(join(dir, e.name), `${prefix}${e.name}/`)] : [`${prefix}${e.name}`]));
mkdirSync(at('code-ops-docs', '80 Runs', 'own'), { recursive: true });
writeFileSync(at('code-ops-docs', '80 Runs', 'own', 'foo'), 'authored file\n');
const streamTargets = [at('code-ops-docs', '80 Runs', 'own', 'foo:bar.md'), at('code-ops-docs', '80 Runs', 'own', 'foo.md:stream.md')];
const listRefused = [
  ['node_modules run folder (ignored, no manifest)', 'Report path: node_modules/80 Runs/x.md'],
  ['deeper x/y/80 Runs (ignored)', 'Report path: x/y/80 Runs/x.md'],
  ['80 Runs two levels below the hub (ignored)', 'Report path: code-ops-docs/x/80 Runs/x.md'],
  ['hub-named folder with no manifest (ignored)', 'Report path: other-docs/80 Runs/x.md'],
  ['bare 80 Runs file directly in the hub folder', 'Report path: code-ops-docs/80 Runs.md'],
  ['alternate data stream on an existing file', 'Report path: code-ops-docs/80 Runs/own/foo:bar.md'],
  ['colon inside a directory segment', 'Report path: code-ops-docs/80 Runs/c:d/x.md'],
  ['drive-relative form', 'Report path: C:code-ops-docs/80 Runs/dr/x.md'],
  ['trailing dot on a directory', 'Report path: code-ops-docs/80 Runs/dot./x.md'],
  ['trailing space on a directory', 'Report path: code-ops-docs/80 Runs/space /x.md'],
  ['reserved name CON.md', 'Report path: code-ops-docs/80 Runs/dev/CON.md'],
  ['reserved name nul.md (lower case)', 'Report path: code-ops-docs/80 Runs/dev/nul.md'],
  ['reserved name Com1.md', 'Report path: code-ops-docs/80 Runs/dev/Com1.md'],
  ['reserved name LPT9.md', 'Report path: code-ops-docs/80 Runs/dev/LPT9.md'],
  ['reserved name PRN.txt.md', 'Report path: code-ops-docs/80 Runs/dev/PRN.txt.md'],
  ['reserved name AUX as a directory', 'Report path: code-ops-docs/80 Runs/AUX/x.md'],
  ['reserved name under .tmp', 'Report path: .claude/.tmp/dev/con.md'],
];
for (const [name, line] of listRefused) {
  const before = listing(repo).join('\n');
  silent(runSave(line), `refuse ${name}`);
  expect(listing(repo).join('\n') === before, `refuse ${name}: nothing may be created`);
  for (const stream of streamTargets) expect(!existsSync(stream), `refuse ${name}: no alternate stream at ${stream}`);
  expect(readFileSync(at('code-ops-docs', '80 Runs', 'own', 'foo'), 'utf8') === 'authored file\n', `refuse ${name}: the existing file keeps its bytes`);
}
// a hub the repository names itself saves; the same folder name without a manifest does not
note(runSave('Report path: acme-docs/80 Runs/run/r.md'), 'save another repository hub');
expect(existsSync(at('acme-docs', '80 Runs', 'run', 'r.md')), 'save another repository hub: file written');
// a host .tmp that git does not ignore is refused, in a repository that has no ignore rule for it
for (const [name, line] of [['host .tmp git does not ignore', 'Report path: .claude/.tmp/bare/r.md'], ['hub run folder git does not ignore', 'Report path: code-ops-docs/80 Runs/bare/r.md']]) {
  silent(runSave(line, { cwd: bare }), `refuse ${name}`);
  expect(listing(bare).length === 0, `refuse ${name}: nothing may be created, got ${listing(bare).join(',')}`);
}
// the same .tmp path saves once git ignores it, and the layout's own `*` ignore file counts
mkdirSync(join(bare, '.claude', '.tmp'), { recursive: true });
writeFileSync(join(bare, '.claude', '.tmp', '.gitignore'), '*\n');
note(runSave('Report path: .claude/.tmp/bare/r.md', { cwd: bare }), 'save .tmp once ignored');
expect(existsSync(join(bare, '.claude', '.tmp', 'bare', 'r.md')), 'save .tmp once ignored: file written');

// a junction inside the run folder that points outside the repository
mkdirSync(at('code-ops-docs', '80 Runs'), { recursive: true });
let junction = true;
try { symlinkSync(outside, at('code-ops-docs', '80 Runs', 'link'), 'junction'); } catch { junction = false; }
if (junction) {
  silent(runSave('Report path: code-ops-docs/80 Runs/link/x.md'), 'refuse junction escape');
  expect(!existsSync(join(outside, 'x.md')), 'refuse junction escape: nothing may be written through the link');
}

// never overwrites a non-empty file, fills an empty one, refuses a directory
mkdirSync(at('code-ops-docs', '80 Runs', 'own'), { recursive: true });
writeFileSync(at('code-ops-docs', '80 Runs', 'own', 'full.md'), 'authored report\n');
writeFileSync(at('code-ops-docs', '80 Runs', 'own', 'empty.md'), '');
mkdirSync(at('code-ops-docs', '80 Runs', 'own', 'dir.md'));
silent(runSave('Report path: code-ops-docs/80 Runs/own/full.md'), 'existing non-empty file');
expect(readFileSync(at('code-ops-docs', '80 Runs', 'own', 'full.md'), 'utf8') === 'authored report\n', 'a non-empty file keeps its bytes');
note(runSave('Report path: code-ops-docs/80 Runs/own/empty.md'), 'existing empty file');
expect(readFileSync(at('code-ops-docs', '80 Runs', 'own', 'empty.md'), 'utf8').includes('ANSWERED: the hook works'), 'an empty file is filled');
silent(runSave('Report path: code-ops-docs/80 Runs/own/dir.md'), 'existing directory');

// the save notice and the advisory share one systemMessage; a failed save never hides the advisory
const both2 = note(runSave('Report path: .claude/.tmp/both/r.md', { message: 'Done. nothing declared' }), 'save plus advisory');
expect(/saved the code-ops-suite:explorer report to \.claude\/\.tmp\/both\/r\.md/.test(both2) && both2.includes('declared verdict'), `save plus advisory: both in one line, got ${JSON.stringify(both2)}`);
const advisoryOnly = note(runSave('Report path: scripts/x.md', { message: 'Done. nothing declared' }), 'refused save keeps advisory');
expect(!/saved/.test(advisoryOnly) && advisoryOnly.includes('declared verdict'), 'refused save: advisory only');

// a brief without a usable Report path, or no readable brief, saves nothing
const noBrief = [
  ['no Report path line', null, {}],
  ['Report path none', 'Report path: none', {}],
  ['prose value', 'Report path: the usual place', {}],
  ['not a user entry', HUB_LINE.replace('D-014', 'D-no-user'), { entry: { type: 'assistant' } }],
  ['not the root entry', HUB_LINE.replace('D-014', 'D-no-root'), { entry: { parentUuid: 'p1' } }],
  ['another agent id', HUB_LINE.replace('D-014', 'D-other-agent'), { entry: { agentId: 'zz' } }],
];
for (const [name, line, opts] of noBrief) {
  const r = runSave(line, opts);
  silent(r, `no save: ${name}`);
}
expect(!existsSync(at('code-ops-docs', '80 Runs', 'model-ladder-fable-5-2-2026-11-09', 'reports', 'D-no-user.md')), 'no save: a non-user first entry');
expect(!existsSync(at('code-ops-docs', '80 Runs', 'model-ladder-fable-5-2-2026-11-09', 'reports', 'D-no-root.md')), 'no save: a non-root first entry');
expect(!existsSync(at('code-ops-docs', '80 Runs', 'model-ladder-fable-5-2-2026-11-09', 'reports', 'D-other-agent.md')), 'no save: another agent id');
silent(runHook(payload('code-ops-suite:explorer', GOOD, { cwd: repo })), 'no save: no transcript path');
silent(runHook(payload('code-ops-suite:explorer', GOOD, { cwd: repo, agent_transcript_path: join(dir, 'absent.jsonl') })), 'no save: missing transcript');
// a working directory that is absent, relative, or outside any repository saves nothing
for (const [name, cwd] of [['relative', 'src'], ['outside a repository', outside], ['absent', null]]) {
  silent(runSave('Report path: .claude/.tmp/cwd/r.md', { cwd }), `no save: cwd ${name}`);
}
expect(!existsSync(at('.claude', '.tmp', 'cwd', 'r.md')) && !existsSync(join(outside, '.claude')), 'no save: a bad working directory writes nothing');
// a non-suite type gets neither a save nor a note
for (const type of ['implementer', 'acme:explorer', 'general-purpose']) {
  const t = join(dir, `nonsuite-${type.replace(/\W/g, '_')}.jsonl`);
  writeFileSync(t, `${JSON.stringify({ type: 'user', parentUuid: null, message: { content: 'Report path: .claude/.tmp/nonsuite/r.md' } })}\n`);
  silent(runHook(payload(type, GOOD, { cwd: repo, agent_transcript_path: t })), `no save: type ${type}`);
}
expect(!existsSync(at('.claude', '.tmp', 'nonsuite')), 'no save: a non-suite type writes nothing');
// malformed input still exits 0 silently
silent(runHook('{"hook_event_name":'), 'no save: bad JSON');

// the switches: off disables everything, nosave keeps the advisory
for (const sw of ['off', 'OFF', '0', 'false']) {
  silent(runSave('Report path: .claude/.tmp/sw/off.md', { env: { CODE_OPS_SUBAGENT_REPORT: sw } }), `save switch ${sw}`);
}
for (const sw of ['nosave', 'NoSave']) {
  silent(runSave('Report path: .claude/.tmp/sw/nosave.md', { env: { CODE_OPS_SUBAGENT_REPORT: sw } }), `save switch ${sw}`);
  const m = note(runSave('Report path: .claude/.tmp/sw/nosave.md', { message: 'Done. nothing declared', env: { CODE_OPS_SUBAGENT_REPORT: sw } }), `advisory under ${sw}`);
  expect(m.includes('declared verdict') && !/saved/.test(m), `advisory under ${sw}: the advisory stays and no save is announced`);
}
expect(!existsSync(at('.claude', '.tmp', 'sw')), 'switches: off and nosave write nothing');

// Grok's camelCase payload saves through agentTranscriptPath and cwd
{
  const t = join(dir, 'grok-save.jsonl');
  writeFileSync(t, `${JSON.stringify({ type: 'user', parentUuid: null, message: { content: 'Report path: .grok/.tmp/g/r.md' } })}\n`);
  const r = runHook(JSON.stringify({ hookEventName: 'subagent_stop', sessionId: 's1', subagentType: 'code-ops-suite:explorer', lastAssistantMessage: GOOD, agentTranscriptPath: t, cwd: repo }), { GROK_PLUGIN_ROOT: suite });
  note(r, 'Grok save');
  expect(existsSync(at('.grok', '.tmp', 'g', 'r.md')), 'Grok save: file written');
}
// read-only rule: each read-only agent saves; a write-capable agent with an absent report gets no save
const READ_ONLY = [
  'code-ops-suite:explorer', 'code-ops-suite:reviewer', 'code-ops-suite:probe', 'code-ops-suite:web-researcher', 'code-ops-suite:mech-review',
  'rigor:tracer', 'researcher:gatherer', 'researcher:claim-checker', 'privacy-opsec-suite:explorer', 'privacy-opsec-suite:privacy-reviewer',
];
for (const type of READ_ONLY) {
  const file = at('.claude', '.tmp', 'ro', `${type.replace(':', '-')}.md`);
  note(runSave(`Report path: .claude/.tmp/ro/${type.replace(':', '-')}.md`, { type }), `read-only save ${type}`);
  expect(existsSync(file), `read-only save ${type}: file written`);
}
for (const [type, verdict] of [['code-ops-suite:implementer', 'DONE'], ['code-ops-suite:mech', 'PASS'], ['rigor:verifier', 'CONFIRMED']]) {
  const file = at('.claude', '.tmp', 'rw', `${type.replace(':', '-')}.md`);
  silent(runSave(`Report path: .claude/.tmp/rw/${type.replace(':', '-')}.md`, { type, message: `${verdict}: pointer` }), `write-capable no save ${type}`);
  expect(!existsSync(file), `write-capable no save ${type}: a skipped report stays missing`);
}
// tools line absent (a host distribution that strips it): the frozen set decides
const stripped = join(dir, 'stripped');
const strippedAgent = (plugin, name, verdicts) => {
  mkdirSync(join(stripped, plugin, '1.0.0', 'agents'), { recursive: true });
  writeFileSync(join(stripped, plugin, '1.0.0', 'agents', `${name}.md`), `---\nname: ${name}\n---\n## Contract\n\nVerdicts: ${verdicts}\n`);
};
strippedAgent('code-ops-suite', 'explorer', 'ANSWERED');
strippedAgent('code-ops-suite', 'implementer', 'DONE');
const strippedEnv = { CLAUDE_PLUGIN_ROOT: join(stripped, 'code-ops-suite', '1.0.0') };
note(runSave('Report path: .claude/.tmp/strip/listed.md', { env: strippedEnv }), 'tools absent, listed agent');
expect(existsSync(at('.claude', '.tmp', 'strip', 'listed.md')), 'tools absent, listed agent: file written');
silent(runSave('Report path: .claude/.tmp/strip/unlisted.md', { env: strippedEnv, type: 'code-ops-suite:implementer', message: 'DONE: pointer' }), 'tools absent, unlisted agent');
expect(!existsSync(at('.claude', '.tmp', 'strip', 'unlisted.md')), 'tools absent, unlisted agent: nothing written');
console.log('ok   only a read-only agent saves: the tools line decides, and a frozen set of ten decides when the line is absent');
console.log('ok   the final message saves to a .md path under 80 Runs (git-ignored) or a host .tmp, and nowhere else');
console.log('ok   an existing non-empty file, a missing brief, a bad working directory, a non-suite type, and the off and nosave switches save nothing');

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nsubagent-report eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nsubagent-report eval passed');
