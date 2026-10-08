#!/usr/bin/env node
// Regression eval for scripts/transcript-recall.mjs: lossless, anchored recall from a host
// transcript. Deterministic, no model call, and no real transcript is ever read: the eval writes a
// synthetic JSONL fixture and passes it with --transcript, with CODE_OPS_HOME, HOME, and
// USERPROFILE pointed at temp directories.
//
//   node evals/transcript-recall/run.mjs
//
// The fixture has a BOM, CRLF and LF lines, multibyte text, two compact_boundary rows, one
// isCompactSummary row, one sidechain row, a message.id group that spans rows, a one-row step, and
// tool_use/tool_result pairs, plus planted needles: a 40-hex SHA in a Bash result, a failing test
// name in an is_error result, an agent id, a decision rationale in free text, a secret-shaped
// string, a planted multi-line private key (Write input, Bash result, free text), and one paraphrase-only fact (a declared miss, reported and not gated). The generator
// records each row's own offset, length, and sha256, so the gates compare the tool's anchors to the
// fixture and never to the tool's own bookkeeping.
//
// Gates:
//   G1 arm A (host summary text) and arm B (compact-snapshot output) miss the tool-result, free-text,
//      and id needles; arm C (search then zoom) recalls each in at most 4 calls with the right anchor;
//   G2 an incremental build after an append equals a full rebuild, byte for byte;
//   G3 a rewritten or truncated transcript fails closed with `anchor drift`;
//   G4 the secret and every line of a planted multi-line private key appear in no index file and no
//      command output (search, zoom, and outline), and a zoom of the key result row shows the marker;
//   G5 `line:<n>` resolves to the right block, and CODE_OPS_RECALL=off|0|false disables;
//   G6 sidechain and compact-summary rows are never nodes and never search hits.
// Mutants patch a temporary copy of scripts/ and must each fail their gate: an offset off by one,
// a scrambled id map, masking disabled, and private key block masking disabled (the scanner then
// redacts only the BEGIN line, so G4 must fail). An unpatched copy is the control and must pass.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, maskTexts } from '../../scripts/compact-snapshot.mjs';
import { conversationOf } from '../../scripts/transcript-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const scriptsDir = join(root, 'scripts');
const { fails, check } = tally();

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SESSION = 'eval-recall-session';
const SECRET = ['ghp', 'Q7rT2xLm9KpZ4vNb8Wc1Yd6Hs3Fj5GaE0uXo'].join('_');
const SHA_NEEDLE = '3f9a1c7e5b2d4a6081c9e7f1a2b3c4d5e6f70812';
const TEST_NEEDLE = 'test_invoice_rounding_cents';
const AGENT_NEEDLE = 'a9f3c2e17b4d5a60';
// A multi-line private key. The header and footer are joined so no literal key header sits in this file.
const PEM_BODY = [
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7planted0001',
  'Zk3TnQ8vYw1ExampleBodyLineTwoAAAAbbbbCCCCddddEEEEffff0123456789',
  'pQ9rS5tUv7WxYz2PlantedLineThreeGGGGhhhhIIIIjjjjKKKKllllMMMM4567',
];
const PEM_TEXT = [['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '), ...PEM_BODY, ['-----END', 'RSA PRIVATE KEY-----'].join(' ')].join('\n');
const SIDECHAIN_TOKEN = 'zq81sidechain';
const SUMMARY_TOKEN = 'summarytoken7731';

// ---------------------------------------------------------------- the generated fixture

function makeFixture() {
  const start = Date.parse('2026-10-01T10:00:00Z');
  let n = 0;
  const base = (extra) => ({ sessionId: SESSION, timestamp: new Date(start + 1000 * n).toISOString(), uuid: `uuid-${String(++n).padStart(3, '0')}`, ...extra });
  const user = (content, extra = {}) => base({ type: 'user', message: { role: 'user', content }, ...extra });
  const assistant = (id, content, extra = {}) => base({ type: 'assistant', message: { id, role: 'assistant', content }, ...extra });
  const text = (t) => ({ type: 'text', text: t });
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const result = (id, body, isError = false) => ({ type: 'tool_result', tool_use_id: id, content: body, ...(isError ? { is_error: true } : {}) });
  const defs = [
    ['r1', user('Audit the café billing module, the naïve rounding looks wrong. 日本語のメモ'), '\r\n'],
    ['r2', assistant('msg_1', [text('Starting the audit of the billing module now.\nDecision: keep the retry budget at three because the vendor rate limit resets hourly.')]), '\r\n'],
    ['r3', assistant('msg_1', [use('toolu_01', 'Bash', { command: 'git log --oneline -1' })]), '\n'],
    ['r4', user([result('toolu_01', `${SHA_NEEDLE} fix rounding in invoice totals`)]), '\n'],
    ['r5', assistant('msg_2', [use('toolu_02', 'Bash', { command: 'node --test' })]), '\n'],
    ['r6', user([result('toolu_02', `Exit code 1\nFAIL ${TEST_NEEDLE}: expected 10.05 but got 10.04`, true)]), '\r\n'],
    ['r7', assistant('msg_3', [text(`Rotated the deploy credential to ${SECRET} and stored it in the vault.`)]), '\n'],
    ['r8', assistant('msg_4', [use('toolu_03', 'Bash', { command: `echo "dispatched worker agent id ${AGENT_NEEDLE}"` })]), '\n'],
    ['r9', user([result('toolu_03', `dispatched worker agent id ${AGENT_NEEDLE}`)]), '\n'],
    ['r10', assistant('msg_side', [text(`Sidechain note ${SIDECHAIN_TOKEN} stays out of the tree.`)], { isSidechain: true }), '\n'],
    ['r11', base({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }), '\n'],
    ['r12', user(`This session is being continued from a previous conversation. Summary: the billing audit is under way and a worker was dispatched. ${SUMMARY_TOKEN}`, { isCompactSummary: true }), '\n'],
    ['r13', user('Continue with the audit report and keep the café notes.'), '\r\n'],
    ['r14', assistant('msg_5', [text('Side note: the cache gets emptied every night around two in the morning.')]), '\n'],
    ['r15', assistant('msg_5', [use('toolu_04', 'Read', { file_path: 'src/billing/invoice.js' })]), '\n'],
    ['r16', user([result('toolu_04', 'function roundCents(x) { return Math.round(x * 100) / 100; }')]), '\n'],
    // A planted private key, three ways: in a Write input, in a multi-line Bash result, and in the
    // opening lines of free text (so a step or block label could carry its body).
    ['p1', assistant('msg_pem1', [use('toolu_p1', 'Write', { file_path: 'deploy/key-material.pem', content: PEM_TEXT })]), '\n'],
    ['p2', user([result('toolu_p1', 'File created')]), '\n'],
    ['p3', assistant('msg_pem2', [use('toolu_p2', 'Bash', { command: 'cat deploy/key-material.pem' })]), '\n'],
    ['p4', user([result('toolu_p2', PEM_TEXT)]), '\r\n'],
    ['p5', assistant('msg_pem3', [text(`Key material follows\n${PEM_TEXT}\nThe key above is rotated.`)]), '\n'],
    ['r17', base({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }), '\n'],
    ['r18', assistant('msg_6', [text('Resuming after the second compaction.')]), '\n'],
    ['r19', assistant('msg_6', [use('toolu_05', 'Grep', { pattern: 'roundCents' })]), '\n'],
    ['r20', user([result('toolu_05', 'src/billing/invoice.js:1:function roundCents')]), '\n'],
    ['r21', user('Thanks, now write the summary.'), '\r\n'],
    ['r22', assistant('msg_7', [text('Done. All checks pass.')]), '\n'],
  ];
  const chunks = [];
  const rows = {};
  let off = 0;
  defs.forEach(([name, obj, eol], i) => {
    const chunk = Buffer.from(`${i === 0 ? '﻿' : ''}${JSON.stringify(obj)}${eol}`);
    const len = chunk.length - 1;
    rows[name] = { name, off, len, sha256: sha(chunk.subarray(0, len)), line: i + 1 };
    chunks.push(chunk);
    off += chunk.length;
  });
  const splitAt = rows.r20.off;
  const full = Buffer.concat(chunks);
  return {
    full, rows, part: full.subarray(0, splitAt), appended: full.subarray(splitAt),
    summaryText: defs.find(([name]) => name === 'r12')[1].message.content,
  };
}

// ---------------------------------------------------------------- running the script under test

function sandbox(label) {
  const home = mkdtempSync(join(tmpdir(), `recall-${label}-home-`));
  const work = mkdtempSync(join(tmpdir(), `recall-${label}-work-`));
  const env = { ...process.env, CODE_OPS_HOME: home, HOME: home, USERPROFILE: home };
  delete env.CODE_OPS_RECALL;
  return { home, work, env, file: join(work, 'session.jsonl'), cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); } };
}

// Every stdout and stderr byte a run produces lands here, for the G4 output scan.
const transcriptOfOutput = [];

function runner(script, box) {
  return (args, { env = box.env, session = SESSION } = {}) => {
    const r = spawnSync(process.execPath, [script, ...args, '--session', session, '--transcript', box.file, '--json'], { cwd: box.work, env, encoding: 'utf8', timeout: 120_000 });
    transcriptOfOutput.push(r.stdout ?? '', r.stderr ?? '');
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
    return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', json };
  };
}

const filesUnder = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
};
const recallFiles = (home) => filesUnder(join(home, '.claude', 'code-ops', 'recall'));
const treeOf = (home) => recallFiles(home).filter((f) => f.endsWith('tree.json')).map((f) => readFileSync(f, 'utf8'))[0] ?? '';
const anchorMatches = (anchors, row) => anchors.some((a) => a.off === row.off && a.len === row.len && a.sha256 === row.sha256);

// ---------------------------------------------------------------- the gates

function runGates(script, fx, only) {
  const found = [];
  const gate = (id, name, ok, detail = '') => { if (!ok) found.push({ id, name, detail }); };
  const want = (id) => !only || only.includes(id);

  const box = sandbox('main');
  const recall = runner(script, box);
  try {
    writeFileSync(box.file, fx.full);
    const needles = [
      { name: 'sha', terms: SHA_NEEDLE, kind: undefined, row: 'r4', literal: SHA_NEEDLE, arms: true },
      { name: 'failing test', terms: TEST_NEEDLE, kind: 'error', row: 'r6', literal: TEST_NEEDLE, arms: true },
      { name: 'agent id', terms: AGENT_NEEDLE, kind: undefined, row: 'r9', literal: AGENT_NEEDLE, arms: true },
      { name: 'decision', terms: 'vendor rate limit', kind: 'text', row: 'r2', literal: 'vendor rate limit resets hourly', arms: true },
      { name: 'multibyte', terms: 'naïve', kind: undefined, row: 'r1', literal: 'naïve rounding', arms: false },
    ];

    if (want('G1')) {
      const arm = {
        A: fx.summaryText,
        B: buildSnapshot({ conversation: conversationOf(fx.full.toString('utf8')), running: [], items: null, runLog: null, mask: (t) => t }).text,
      };
      gate('G1', 'arm B is not vacuous (it carries the operator words)', arm.B.includes('billing') && arm.A.includes(SUMMARY_TOKEN));
      for (const nd of needles) {
        if (nd.arms) gate('G1', `arms A and B miss the ${nd.name} needle`, !arm.A.includes(nd.literal) && !arm.B.includes(nd.literal) && !arm.A.includes(nd.terms) && !arm.B.includes(nd.terms));
        const args = ['search', '--terms', nd.terms, ...(nd.kind ? ['--kind', nd.kind] : [])];
        const found1 = recall(args);
        const top = found1.json?.results?.[0];
        gate('G1', `search finds the ${nd.name} needle`, found1.status === 0 && Boolean(top?.id));
        const zoomed = top ? recall(['zoom', '--id', top.id]) : null;
        gate('G1', `zoom returns the ${nd.name} needle text`, zoomed?.status === 0 && String(zoomed.json?.text).includes(nd.literal));
        const anchors = zoomed?.json?.anchors ?? [];
        gate('G1', `the ${nd.name} anchor is the fixture row (offset, length, sha256)`, anchorMatches(anchors, fx.rows[nd.row]));
        gate('G1', `every ${nd.name} anchor hashes to its own fixture bytes`, anchors.length > 0 && anchors.every((a) => sha(fx.full.subarray(a.off, a.off + a.len)) === a.sha256 && zoomed.json.verified === true));
      }
      const para = recall(['search', '--terms', 'nightly flush']);
      console.log(`info declared miss (paraphrase-only fact): search for the paraphrase returned ${para.json?.total ?? '?'} result(s); not gated`);
    }

    if (want('G2')) {
      const inc = sandbox('inc');
      const full = sandbox('full');
      try {
        const a = runner(script, inc);
        const b = runner(script, full);
        writeFileSync(inc.file, Buffer.concat([fx.part, fx.appended.subarray(0, 25)]));
        const first = a(['build']);
        gate('G2', 'the first build reads the complete lines only', first.status === 0 && first.json?.action === 'full');
        writeFileSync(inc.file, fx.full);
        const second = a(['build']);
        gate('G2', 'the build after an append runs incrementally', second.status === 0 && second.json?.action === 'incremental');
        writeFileSync(full.file, fx.full);
        const rebuilt = b(['build']);
        gate('G2', 'the reference build runs in full', rebuilt.status === 0 && rebuilt.json?.action === 'full');
        const left = treeOf(inc.home);
        gate('G2', 'incremental tree.json equals the full rebuild byte for byte', left.length > 0 && left === treeOf(full.home));
        gate('G2', 'a second build with nothing new does nothing', a(['build']).json?.action === 'none');
        const status = a(['status']);
        gate('G2', 'status reports a current index with both compactions', status.json?.current === true && status.json?.boundaries === 2 && status.json?.indexedBytes === fx.full.length);
      } finally { inc.cleanup(); full.cleanup(); }
    }

    if (want('G3')) {
      const hit = recall(['search', '--terms', SHA_NEEDLE]).json?.results?.[0];
      const copy = sandbox('drift');
      try {
        const d = runner(script, copy);
        writeFileSync(copy.file, fx.full);
        const id = d(['search', '--terms', SHA_NEEDLE]).json?.results?.[0]?.id;
        gate('G3', 'the drift fixture has an anchor to test', Boolean(id) && id === hit?.id);
        const rewritten = Buffer.from(fx.full);
        const at = rewritten.indexOf(SHA_NEEDLE);
        rewritten[at] = rewritten[at] === 0x66 ? 0x65 : 0x66;
        writeFileSync(copy.file, rewritten);
        const meta = readFileSync(recallFiles(copy.home).find((f) => f.endsWith('meta.json')), 'utf8');
        const bad = d(['zoom', '--id', id]);
        gate('G3', 'a same-length rewrite fails closed with anchor drift', bad.status === 1 && bad.json?.error === 'anchor drift' && !bad.out.includes(SHA_NEEDLE.slice(1, 20)));
        writeFileSync(copy.file, fx.full);
        truncateSync(copy.file, fx.rows.r4.off + 10);
        const short = d(['zoom', '--id', id]);
        gate('G3', 'a truncated transcript fails closed with anchor drift', short.status === 1 && short.json?.error === 'anchor drift' && !short.out.includes('fix rounding'));
        gate('G3', 'zoom never rebuilds the index on its own', readFileSync(recallFiles(copy.home).find((f) => f.endsWith('meta.json')), 'utf8') === meta);
      } finally { copy.cleanup(); }
    }

    if (want('G4')) {
      gate('G4', 'the masker catches the secret shape (precondition)', maskTexts([`token ${SECRET}`])[0].includes('REDACTED'));
      const probe = recall(['search', '--terms', SECRET]);
      const top = probe.json?.results?.[0];
      gate('G4', 'a search for the secret finds its row and shows it masked', Boolean(top) && String(top.snippet).includes('REDACTED') && !probe.out.includes(SECRET));
      const zoomed = top ? recall(['zoom', '--id', top.id]) : null;
      gate('G4', 'zoom of the secret row shows it masked', zoomed?.status === 0 && String(zoomed.json?.text).includes('REDACTED'));
      // The planted private key: search it by file name and by header words, zoom every hit and each
      // row that carries it, and read the outline. No body line may reach any output or index file.
      const pemSearches = [recall(['search', '--terms', 'deploy/key-material.pem']), recall(['search', '--terms', 'private key'])];
      gate('G4', 'the private key searches find the planted rows', pemSearches.every((s) => s.status === 0 && (s.json?.results?.length ?? 0) > 0));
      for (const s of pemSearches) for (const hit of s.json?.results ?? []) recall(['zoom', '--id', hit.id]);
      const pemZooms = ['p1', 'p3', 'p4', 'p5'].map((name) => recall(['zoom', '--id', `line:${fx.rows[name].line}`]));
      gate('G4', 'zoom of each private key row succeeds', pemZooms.every((z) => z.status === 0));
      gate('G4', 'zoom of the key result row shows the redaction marker', String(pemZooms[2].json?.text).includes('REDACTED'));
      recall(['outline', '--depth', '4']);
      const scanOutput = transcriptOfOutput.join('\n');
      const body = SECRET.slice(4, 24);
      gate('G4', 'the secret appears in no command output', !scanOutput.includes(SECRET) && !scanOutput.includes(body));
      gate('G4', 'no private key body line appears in any command output', PEM_BODY.every((line) => !scanOutput.includes(line)));
      const files = recallFiles(box.home);
      gate('G4', 'the index files exist', files.length >= 2);
      gate('G4', 'the secret appears in no file under the recall directory', files.every((f) => { const t = readFileSync(f, 'utf8'); return !t.includes(SECRET) && !t.includes(body); }));
      gate('G4', 'no private key body line appears in any file under the recall directory', files.every((f) => { const t = readFileSync(f, 'utf8'); return PEM_BODY.every((line) => !t.includes(line)); }));
      gate('G4', 'the index carries the redaction placeholder', treeOf(box.home).includes('REDACTED'));
    }

    if (want('G5')) {
      const byLine = recall(['zoom', '--line', String(fx.rows.r4.line)]);
      gate('G5', 'line:<n> of a tool result resolves to its block', byLine.status === 0 && anchorMatches(byLine.json?.anchors ?? [], fx.rows.r3) && anchorMatches(byLine.json.anchors, fx.rows.r4));
      const byRef = recall(['zoom', '--id', `line:${fx.rows.r1.line}`]);
      gate('G5', 'line:1 resolves to the BOM prompt row', byRef.status === 0 && anchorMatches(byRef.json?.anchors ?? [], fx.rows.r1));
      const skipped = recall(['zoom', '--line', String(fx.rows.r10.line)]);
      gate('G5', 'a sidechain line is not a block', skipped.status === 1);
      for (const value of ['off', '0', 'false']) {
        const idle = sandbox('off');
        try {
          writeFileSync(idle.file, fx.full);
          const r = runner(script, idle)(['status'], { env: { ...idle.env, CODE_OPS_RECALL: value } });
          gate('G5', `CODE_OPS_RECALL=${value} disables with a one-line notice`, r.status === 0 && /disabled/.test(r.out) && r.out.trim().split('\n').length === 1 && recallFiles(idle.home).length === 0);
        } finally { idle.cleanup(); }
      }
    }

    if (want('G6')) {
      for (const token of [SIDECHAIN_TOKEN, SUMMARY_TOKEN]) {
        const r = recall(['search', '--terms', token]);
        gate('G6', 'a sidechain or compact-summary token is never a search hit', r.status === 0 && r.json?.total === 0);
      }
      recall(['status']);
      const nodes = JSON.parse(treeOf(box.home) || '{"nodes":[]}').nodes;
      const covered = new Set(nodes.flatMap((nd) => [nd.off, ...(nd.res ?? []).map((x) => x.off)]));
      gate('G6', 'no node anchors at a sidechain or compact-summary row', !covered.has(fx.rows.r10.off) && !covered.has(fx.rows.r12.off));
      const outline = recall(['outline', '--depth', '3']);
      gate('G6', 'the tree has three epochs below the session', recall(['outline']).json?.items?.filter((it) => it.kind === 'epoch').length === 3 && outline.status === 0);
    }
  } finally { box.cleanup(); }
  return found;
}

// ---------------------------------------------------------------- mutants

function mutantCopy(label, from, to, target = 'transcript-recall.mjs') {
  const dir = mkdtempSync(join(tmpdir(), `recall-${label}-scripts-`));
  cpSync(scriptsDir, dir, { recursive: true });
  const file = join(dir, 'transcript-recall.mjs');
  const patched = join(dir, target);
  const text = readFileSync(patched, 'utf8');
  const parts = from === null ? [text] : text.split(from);
  if (parts.length !== 2 && from !== null) throw new Error(`mutant ${label}: expected exactly one match, found ${parts.length - 1}`);
  if (from !== null) writeFileSync(patched, parts.join(to));
  return { dir, file };
}

const MUTANTS = [
  { name: 'offset off by one', from: 'off: base + rec.off, len: rec.len, line', to: 'off: base + rec.off + 1, len: rec.len, line', gate: 'G1' },
  { name: 'scrambled id map', from: 'byId.set(n.id, n);', to: 'byId.set(n.id, nodes[(i + 1) % nodes.length]);', gate: 'G1' },
  { name: 'masking disabled', from: 'out = maskTexts(texts);', to: 'out = texts;', gate: 'G4' },
  { name: 'PEM block masking disabled', target: 'compact-snapshot.mjs', from: "export const redactBlocks = (text) => text.replace(PEM_BLOCK, '<REDACTED:secret-shape>');", to: 'export const redactBlocks = (text) => text;', gate: 'G4' },
];

// ---------------------------------------------------------------- main

const fx = makeFixture();
const started = Date.now();
const real = runGates(join(scriptsDir, 'transcript-recall.mjs'), fx);
check('real script passes G1-G6', real.length === 0, real.map((f) => `${f.id} ${f.name}`).join('; '));
for (const f of real) console.log(`  x ${f.id}: ${f.name}`);

const control = mutantCopy('control', null, null);
try {
  const result = runGates(control.file, fx, ['G1', 'G4']);
  check('unpatched copy passes the mutant gates (control)', result.length === 0, result.map((f) => `${f.id} ${f.name}`).join('; '));
} finally { rmSync(control.dir, { recursive: true, force: true }); }

for (const mutant of MUTANTS) {
  const copy = mutantCopy(mutant.name.replace(/\W+/g, '-'), mutant.from, mutant.to, mutant.target);
  try {
    const result = runGates(copy.file, fx, [mutant.gate]);
    check(`mutant fails ${mutant.gate}: ${mutant.name}`, result.length > 0, 'the eval passed with the mutant applied');
  } finally { rmSync(copy.dir, { recursive: true, force: true }); }
}

console.log(`info ${Math.round((Date.now() - started) / 1000)}s on node ${process.version}`);
if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\ntranscript-recall eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\ntranscript-recall eval passed');
