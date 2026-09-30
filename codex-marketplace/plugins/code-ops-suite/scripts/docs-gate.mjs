#!/usr/bin/env node
// The docs gate: one command that runs every docs check in order and ratchets the result
// (design "Program state handoffs and coordination", workstream W6).
//
//   node scripts/docs-gate.mjs [--root <repo>] [--baseline-init] [--check]
// `co docs gate` reaches it.
//
// WHY: each docs script fails closed on its own, but an adopter needs one CI step and one
// pre-commit entry, and needs to adopt the gate on a repository that already has violations.
// The ratchet gives it that: existing violations are recorded once, and only new ones fail.
//
// A repository with no `<hub>/98 System/DOCS_MANIFEST.json` has not adopted the docs layer. The gate
// prints a skip line and exits 0.
//
// STEPS, in order (numbers follow the design's W6 list)
//   1. `docs-manifest.mjs check`.
//   2. `records.mjs check` and `records.mjs verify-history --strict` for each manifest record
//      collection. NOT IMPLEMENTED: the intake age rule, because records.mjs exposes none.
//   3. `check-vault-standard.mjs` over the hub.
//   4. NOT IMPLEMENTED: register freshness (records.mjs render --register has no check-only mode),
//      the invariant check, and state budgets (docs-manifest.mjs validates the `state` block's
//      shape and nothing reads its budgetWords).
//   5. Draft and staleness rules. They live in check-vault-standard.mjs, so they run in step 3's
//      one invocation and report under step 3's number.
//   6. Legacy-path guards (design W3). A relocated path is a `from` in `<hub>/98 System/FORWARDING.json`
//      or a manifest `removed` legacy root. The step fails on
//        - an invalid FORWARDING.json;
//        - a `removed` root that still exists on disk. docs-manifest.mjs already reports that in
//          step 1, so step 6 adds a violation only when step 1 did not report the entry;
//        - a tracked file that names a relocated path, unless it is history or a path-map file.
//          History is record bytes, `80 Runs`, `99 Archive`, `98 System/Records`, PROGRAM.md,
//          PROGRAM.archive.md, HANDOFF.md, FORWARDING.json, the manifest, and the baseline
//          (`isHistory` in docs-relocate.mjs). The key is `<file> references relocated path <from>`,
//          with no line number, so the ratchet stays stable as the file changes.
//      A repository with no FORWARDING.json and no removed root reads no file text.
//   7. The tracked-run set against `runs.tracking` and each run's retention class. SKIPPED: a later PR.
//   8. `check-handoff.mjs` ledger checks 11 to 18 over every open grammar 2 program whose
//      PROGRAM.md is tracked on the current branch. The gate runs check-handoff on the tracked
//      HANDOFF.md with the highest Hop whose `Program:` names the ledger, and keeps only the
//      `check 11` to `check 18` violations. A tracked ledger with no such handoff prints a warning
//      and its checks do not run. An untracked ledger under `<hub>/80 Runs/programs/` gets check 14
//      only, as an UNLANDED warning that never fails, so a promotion on one branch never blocks
//      commits on another.
//
// RATCHET. A violation is `{step, key}` with a stable key. `<hub>/98 System/GATE_BASELINE.jsonl`
// holds one sorted JSON line per baselined violation.
//   - No baseline file: `--baseline-init` writes every live violation, and a run without the flag
//     fails when any violation exists and names the flag. With no violations it passes.
//   - A baseline file: any live violation not in it fails. A baseline line that is no longer live
//     is removed from the file at the next run. The baseline never grows, so `--baseline-init`
//     refuses when the file exists.
//   - `--check` never writes. It fails when a baseline line is no longer live, so CI catches an
//     uncommitted shrink. CI must use `--check`.
//
// Exit: 0 = pass or skip; 1 = a new violation, an unlisted fixed line under --check, or an
// unreadable baseline; 2 = usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, parseOrDie, usage } from './cli-lib.mjs';
import { findRefs, isHistory, readText } from './docs-relocate.mjs';
import { promotedIds, recordState } from './promotion-lib.mjs';
import { forwardingErrors } from './record-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: docs-gate.mjs [--root <repo>] [--baseline-init] [--check]';
const MANIFEST_TAIL = '/98 System/DOCS_MANIFEST.json';
const BASELINE_NAME = 'GATE_BASELINE.jsonl';
const LEDGER_RE = /(?:^|\/)programs\/[^/]+\/PROGRAM\.md$/;
const LEDGER_CHECK_RE = /^\s+- (check 1[1-8]: .+)$/;

const { flags } = parseOrDie(process.argv.slice(2), {
  root: { value: true, default: '.', missing: 'needs a path' },
  'baseline-init': { value: false },
  check: { value: false },
}, USAGE);
if (flags['baseline-init'] && flags.check) usage(['x --check never writes, so it cannot combine with --baseline-init', USAGE]);
const root = resolve(flags.root);

const found = [];
const add = (step, key) => found.push({ step, key });
const firstLine = (text) => text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';

// One sibling script as a subprocess with its current CLI. A script this copy does not carry is a
// failed step, never a silent pass.
function sibling(script, args) {
  const file = join(HERE, script);
  if (!existsSync(file)) return { status: null, out: `${script} is not bundled beside docs-gate.mjs` };
  const r = spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

let paths;
try { paths = git(['ls-files', '-z'], { cwd: root, timeout: 60000 }).split('\0').filter(Boolean); } catch {
  console.error(`x ${root} is not a git repository, so the docs gate cannot list its files`);
  process.exit(2);
}
const tracked = new Set(paths);
const manifests = git(['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, timeout: 60000 })
  .split('\0').filter((p) => p.endsWith(MANIFEST_TAIL));
if (manifests.length === 0) {
  console.log(`docs gate: skipped, no <hub>${MANIFEST_TAIL} in ${root}`);
  process.exit(0);
}
const hub = manifests.length === 1 ? manifests[0].slice(0, -MANIFEST_TAIL.length) : null;

const report = [];
const perStep = (step) => found.filter((v) => v.step === step).length;
const verdict = (step) => (perStep(step) ? `${perStep(step)} violation(s)` : 'ok');

// ---- 1. docs-manifest check ----
if (hub === null) add(1, `multiple documentation manifests found: ${manifests.join(', ')}`);
else {
  const r = sibling('docs-manifest.mjs', ['check', '--root', root]);
  if (r.status !== 0) {
    const lines = r.out.split(/\r?\n/).map((l) => /^\s+- (.+)$/.exec(l)?.[1]).filter(Boolean);
    for (const line of lines.length ? lines : [firstLine(r.out) || 'docs-manifest check failed']) add(1, line);
  }
}
report.push(`  1 docs-manifest check: ${verdict(1)}`);

if (hub === null) {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) report.push(`  ${n} skipped: no single documentation hub`);
} else {
  // ---- 2. records check and verify-history per collection ----
  let collections = [];
  try { collections = JSON.parse(readFileSync(join(root, hub, '98 System', 'DOCS_MANIFEST.json'), 'utf8')).recordCollections ?? []; } catch { /* step 1 reported it */ }
  const ids = collections.map((c) => c?.id).filter((id) => typeof id === 'string');
  for (const id of ids) {
    for (const [label, args] of [['check', ['check']], ['verify-history', ['verify-history', '--strict']]]) {
      const r = sibling('records.mjs', [...args, '--root', root, '--collection', id]);
      if (r.status !== 0) add(2, `records ${label} ${id}: ${firstLine(r.out) || `exit ${r.status}`}`);
    }
  }
  report.push(`  2 records check and verify-history (${ids.length} collection(s)): ${verdict(2)}; intake age rule: not implemented (records.mjs exposes none)`);

  // ---- 3 and 5. check-vault-standard, which carries the draft and staleness rules ----
  const vault = sibling('check-vault-standard.mjs', [join(root, hub)]);
  if (vault.status !== 0) {
    const lines = vault.out.split(/\r?\n/).map((l) => /^\s*!!\s+VIOLATION\s+(.+)$/.exec(l)?.[1]).filter(Boolean);
    for (const line of lines.length ? lines : [firstLine(vault.out) || 'check-vault-standard failed']) add(3, line);
  }
  report.push(`  3 check-vault-standard: ${verdict(3)}`);
  report.push('  4 register freshness, invariant, state budgets: not implemented');
  report.push('  5 draft and staleness rules: run by check-vault-standard in step 3');

  // ---- 6. legacy-path guards ----
  const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
  const manifestDoc = readJson(join(root, hub, '98 System', 'DOCS_MANIFEST.json'));
  const legacyEntries = Array.isArray(manifestDoc?.legacyPaths) ? manifestDoc.legacyPaths : [];
  const removed = legacyEntries.map((entry, index) => ({ path: entry?.disposition === 'removed' ? entry.path : null, index })).filter((entry) => typeof entry.path === 'string');
  const forwardFile = join(root, hub, '98 System', 'FORWARDING.json');
  const forwarding = existsSync(forwardFile) ? readJson(forwardFile) : { version: 1, forwards: [] };
  const forwardProblems = forwardingErrors(forwarding);
  for (const problem of forwardProblems) add(6, `FORWARDING.json is invalid: ${problem}`);
  for (const { path, index } of removed) {
    const reported = found.some((v) => v.step === 1 && v.key === `legacy path ${index + 1} is removed but still exists on disk`);
    if (existsSync(join(root, path)) && !reported) add(6, `removed legacy root ${path} still exists on disk`);
  }
  const relocated = [...new Set([...(forwardProblems.length ? [] : forwarding.forwards.map((forward) => forward.from)), ...removed.map((entry) => entry.path)])];
  if (relocated.length) {
    const history = collections.map((c) => c?.root).filter((path) => typeof path === 'string');
    for (const file of paths) {
      if (isHistory(file, hub, history)) continue;
      const text = readText(root, file);
      if (text === null) continue;
      for (const hit of findRefs(text, relocated)) {
        const from = relocated.filter((p) => hit.path === p || hit.path.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
        if (from) add(6, `${file} references relocated path ${from}`);
      }
    }
  }
  report.push(`  6 legacy-path guards: ${verdict(6)} (${relocated.length ? `${relocated.length} relocated path(s)` : 'no relocated paths'})`);
  report.push('  7 tracked-run set: skipped (later PR)');

  // ---- 8. ledger checks 11 to 18 ----
  const notes = [];
  const readOrNull = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
  const handoffs = paths.filter((p) => /(?:^|\/)HANDOFF\.md$/.test(p)).map((path) => {
    const text = readOrNull(join(root, path)) ?? '';
    const program = /^[-*\t ]*Program:[^\S\r\n]*(.+)$/m.exec(text)?.[1].trim().replace(/^`(.*)`$/, '$1');
    return { path, program: program ? resolve(root, program) : null, hop: Number(/^[-*\t ]*Hop:[^\S\r\n]*(\d+)/m.exec(text)?.[1] ?? 0) };
  });
  const runsPrograms = join(root, hub, '80 Runs', 'programs');
  let onDisk = [];
  try { onDisk = readdirSync(runsPrograms, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${hub}/80 Runs/programs/${e.name}/PROGRAM.md`); } catch { /* no runs folder */ }
  const ledgers = [...new Set([...paths.filter((p) => LEDGER_RE.test(p)), ...onDisk])].sort();
  let checked = 0;
  for (const ledger of ledgers) {
    const text = readOrNull(join(root, ledger));
    const slug = ledger.split('/').at(-2);
    if (text === null) continue;
    if (!/^[-*\t ]*Grammar:[^\S\r\n]*2\s*$/m.test(text)) { notes.push(`  ${slug}: grammar 1, checks 11-18 do not apply`); continue; }
    if (/^[-*\t ]*Status:[^\S\r\n]*(?:merged into .+?|closed)\s*$/m.test(text)) { notes.push(`  ${slug}: not open`); continue; }
    if (tracked.has(ledger)) {
      const handoff = handoffs.filter((h) => h.program === resolve(root, ledger)).sort((a, b) => b.hop - a.hop || (a.path < b.path ? 1 : -1))[0];
      if (!handoff) { notes.push(`  warning: ${slug}: no tracked HANDOFF.md names this ledger, so checks 11-18 did not run`); continue; }
      const r = sibling('check-handoff.mjs', [join(root, handoff.path), '--root', root]);
      checked++;
      if (r.status !== 0 && r.status !== 1) { add(8, `${slug}: check-handoff did not run: ${firstLine(r.out) || `exit ${r.status}`}`); continue; }
      for (const line of r.out.split(/\r?\n/)) { const m = LEDGER_CHECK_RE.exec(line); if (m) add(8, `${slug}: ${m[1]}`); }
      continue;
    }
    // An untracked ledger belongs to another branch's work. Only check 14, and only as a warning.
    const archive = readOrNull(join(root, dirname(ledger), 'PROGRAM.archive.md')) ?? '';
    for (const { dec, recordId } of promotedIds(`${text}\n${archive}`)) {
      const { where } = recordState(root, recordId, { hub });
      if (where === 'sealed') continue;
      notes.push(`  warning: UNLANDED ${slug} ${dec ?? 'a decision'} promoted:${recordId} ${where === 'pending' ? 'is staged in intake and not yet sealed' : 'is in neither state.json nor intake on this branch'}`);
    }
  }
  report.push(`  8 ledger checks 11-18 (${checked} tracked program(s)): ${verdict(8)}`, ...notes);
}

// ---- ratchet ----
const keyOf = ({ step, key }) => JSON.stringify({ step, key });
const compare = (a, b) => a.step - b.step || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const live = [...new Map(found.map((v) => [keyOf(v), v])).values()].sort(compare);
const serialize = (list) => list.map(keyOf).join('\n') + (list.length ? '\n' : '');
const baselinePath = hub === null ? null : join(root, hub, '98 System', BASELINE_NAME);

console.log(`docs gate ${root}`);
for (const line of report) console.log(line);
const list = (items) => { for (const v of items) console.error(`  x step ${v.step}: ${v.key}`); };
const finish = (pass, text) => { console.log(`docs gate: ${pass ? 'PASS' : 'FAIL'}, ${text}`); process.exit(pass ? 0 : 1); };

if (baselinePath === null) { list(live); finish(false, `${live.length} violation(s) and no single hub to hold a baseline`); }
if (!existsSync(baselinePath)) {
  if (flags['baseline-init']) {
    writeFileSync(baselinePath, serialize(live));
    finish(true, `wrote ${BASELINE_NAME} with ${live.length} existing violation(s); commit it`);
  }
  if (live.length) {
    list(live);
    finish(false, `${live.length} violation(s) and no ${BASELINE_NAME}; fix them, or record them as the baseline with --baseline-init`);
  }
  finish(true, 'no violations');
}
if (flags['baseline-init']) usage([`x ${BASELINE_NAME} already exists and the baseline never grows; fix the new violations instead`, USAGE]);

const baseline = [];
for (const [index, raw] of readFileSync(baselinePath, 'utf8').split(/\r?\n/).entries()) {
  if (!raw.trim()) continue;
  let entry;
  try { entry = JSON.parse(raw); } catch { entry = null; }
  if (!entry || !Number.isInteger(entry.step) || typeof entry.key !== 'string') {
    console.error(`x ${BASELINE_NAME} line ${index + 1} is not a {"step","key"} object`);
    process.exit(1);
  }
  baseline.push({ step: entry.step, key: entry.key });
}
const liveKeys = new Set(live.map(keyOf));
const baselineKeys = new Set(baseline.map(keyOf));
const fresh = live.filter((v) => !baselineKeys.has(keyOf(v)));
const fixed = baseline.filter((v) => !liveKeys.has(keyOf(v))).sort(compare);
list(fresh);
if (fixed.length && flags.check) {
  for (const v of fixed) console.error(`  x baseline line no longer live: step ${v.step}: ${v.key}`);
} else if (fixed.length) {
  writeFileSync(baselinePath, serialize(baseline.filter((v) => liveKeys.has(keyOf(v))).sort(compare)));
  console.log(`docs gate: removed ${fixed.length} fixed line(s) from ${BASELINE_NAME}; commit it`);
}
const stale = flags.check ? fixed.length : 0;
finish(fresh.length === 0 && stale === 0,
  `${fresh.length} new violation(s), ${stale} stale baseline line(s), ${live.length - fresh.length} baselined`);
