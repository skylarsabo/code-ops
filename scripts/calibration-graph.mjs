#!/usr/bin/env node
// Calibration knowledge-graph store tool — the read/write side of evals/calibration/, the
// structured successor to a hand-appended row in evals/CALIBRATION_TABLE.md (which this
// script now RENDERS; see `render`). Root-only: never vendored into plugins/.
//
//   node scripts/calibration-graph.mjs validate [--store <dir>] [--root <dir>]
//   node scripts/calibration-graph.mjs render [--check] [--store <dir>] [--table <file>] [--root <dir>]
//   node scripts/calibration-graph.mjs query <open|deferred|unenforced|unverified|recurrent|trend|cross-model> [--gate] [--store <dir>] [--root <dir>]
//   node scripts/calibration-graph.mjs query lesson L-NNN [--store <dir>] [--root <dir>]
//   node scripts/calibration-graph.mjs ingest --note <file> [--id R-NNN] [--label <text>] [--store <dir>]
//
// WHY: the calibration channel used to end in one appended table row, so a lesson's life
// after the run — did a PR fix it, is a gate holding it, did a later run confirm the fix
// landed, has it recurred — lived only in prose nobody could query. The store makes those
// relations first-class (runs, lessons, edges), and every number in the trend table becomes
// DERIVED from a run document instead of hand-typed. Two failure modes drive the design:
// a lesson that recurs because its "fix" was never enforced by anything mechanical, and a
// table cell that drifts from the run it claims to summarize. `validate` fails closed on the
// first; `render --check` fails closed on the second.
//
// The store is repo-side of the one-way calibration channel (evals/README.md): every field
// it holds has already passed scripts/calibration-metrics.mjs --validate-note. This script
// never reads a target repo and never emits a path from one — `ingest` consumes only the
// sanitized note's Machine block (counts, kebab slugs, enum words).
//
// Derived, never stored: confirmedRatio, confirmedPer100kTokens, refutationSurvival, and
// recurrence (a lesson listed by >=2 runs). Likewise surfaced-in / recurred-in are read off
// the run docs' `lessons` arrays — storing them as edges would let the two disagree.
//
// Exit: 0 = clean (validate passed / render wrote or was already current / a query ran);
// 1 = a violation, drift, a refused ingest, or a --gate'd query with RED lines;
// 2 = usage error (unknown subcommand or flag, missing required flag, unreadable store).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerOfConfigSlug } from './model-tiers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_DEFAULT = resolve(HERE, '..');

function usage() {
  console.error('usage: calibration-graph.mjs validate [--store <dir>] [--root <dir>]');
  console.error('       calibration-graph.mjs render [--check] [--store <dir>] [--table <file>] [--root <dir>]');
  console.error('       calibration-graph.mjs query <open|deferred|unenforced|unverified|recurrent|trend|cross-model> [--gate] [--store <dir>] [--root <dir>]');
  console.error('       calibration-graph.mjs query lesson L-NNN [--store <dir>] [--root <dir>]');
  console.error('       calibration-graph.mjs ingest --note <file> [--id R-NNN] [--label <text>] [--store <dir>]');
  process.exit(2);
}

// Shared flag parser, same contract as scripts/dispatch-ledger.mjs: --flag value pairs, with a
// missing/blank value or one that looks like another flag rejected rather than swallowed.
function parseFlags(args, known, bare = new Set()) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (bare.has(a)) { out[a] = true; continue; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    if (!known.has(a)) { console.error(`x unknown argument: ${a}`); usage(); }
    const v = args[++i];
    if (v === undefined || v.trim() === '' || v.startsWith('--')) { console.error(`x ${a} needs a value`); process.exit(2); }
    out[a] = v;
  }
  return out;
}

// ---------------------------------------------------------------- ID grammars

const RUN_ID_RE = /^R-\d{3}$/;
const LESSON_ID_RE = /^L-\d{3}$/;
const PR_ID_RE = /^PR-\d+$/;
// A fix that landed as a direct commit with no PR behind it. Shape-only, exactly like PR-NN:
// neither form is resolved against GitHub or the object database, because both are historical
// records and a resolution check would fail falsely in a shallow clone that no longer holds
// the object. Additive vocabulary — PR-NN keeps its meaning untouched.
const COMMIT_ID_RE = /^COMMIT:[0-9a-f]{7,40}$/;
const GATE_ID_RE = /^GATE:([^#\s]+)#([a-z0-9][a-z0-9-]*)$/;
const EVAL_ID_RE = /^EVAL:(\S+)$/;
const VER_ID_RE = /^VER:[a-z0-9][a-z0-9-]*@\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Ordered plus-separated model classes; a mid-run lead handover records every lead class in order.
const CONFIG_LEAD_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\+[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

const LESSON_CLASSES = ['instrument', 'suite', 'protocol'];
const TRACKS = ['assess-only', 'implement'];
const RELS = ['fixed-in', 'enforced-by', 'verified-in', 'deferred', 'supersedes'];
const SEVERITY_KEYS = ['critical', 'high', 'medium', 'low', 'nit'];

// ---------------------------------------------------------------- store loading

function readJson(path, label, problems) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (e) { console.error(`x cannot read ${label} (${path}): ${e.message}`); process.exit(2); }
  try { return JSON.parse(text); }
  catch (e) { problems.push(`${label}: not valid JSON — ${e.message}`); return null; }
}

// The store is three shapes on disk: runs/*.json, lessons.json, edges.jsonl. A missing store
// is a usage error (wrong --store), not a violation — a violation is a store that IS there and
// is wrong. Parse failures land in `problems` so validate reports every one at once.
function loadStore(storeDir) {
  const problems = [];
  const runsDir = join(storeDir, 'runs');
  if (!existsSync(storeDir)) { console.error(`x store not found: ${storeDir}`); process.exit(2); }
  if (!existsSync(runsDir)) { console.error(`x store has no runs/ directory: ${runsDir}`); process.exit(2); }

  const runFiles = readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort();
  const runs = [];
  for (const f of runFiles) {
    const doc = readJson(join(runsDir, f), `runs/${f}`, problems);
    if (doc !== null) runs.push({ file: f, doc });
  }

  const lessonsPath = join(storeDir, 'lessons.json');
  let lessons = [];
  if (!existsSync(lessonsPath)) problems.push('lessons.json: missing');
  else {
    const parsed = readJson(lessonsPath, 'lessons.json', problems);
    if (parsed === null) lessons = [];
    else if (!Array.isArray(parsed)) problems.push('lessons.json: must be an array of lesson nodes');
    else lessons = parsed;
  }

  const edgesPath = join(storeDir, 'edges.jsonl');
  const edges = [];
  if (!existsSync(edgesPath)) problems.push('edges.jsonl: missing');
  else {
    let text;
    try { text = readFileSync(edgesPath, 'utf8'); }
    catch (e) { console.error(`x cannot read edges.jsonl: ${e.message}`); process.exit(2); }
    text.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '').trim();
      if (line === '') return;
      let obj;
      try { obj = JSON.parse(line); }
      catch (e) { problems.push(`edges.jsonl L${i + 1}: not valid JSON — ${e.message}`); return; }
      edges.push({ ...obj, line: i + 1 });
    });
  }

  return { storeDir, runs, lessons, edges, problems };
}

// ---------------------------------------------------------------- schema validation

const isInt = (v) => Number.isInteger(v);
const isNullableInt = (v) => v === null || Number.isInteger(v);

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Every violation is pushed with a NAMED REASON prefix so a failing gate says which class of
// problem fired (schema / duplicate-id / non-monotonic / dangling-edge / unknown-lesson /
// orphan-lesson) instead of just "invalid".
function validateRunDoc(entry, problems) {
  const { file, doc } = entry;
  const at = `runs/${file}`;
  const bad = (reason) => problems.push(`schema: ${at}: ${reason}`);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) { bad('run doc must be a JSON object'); return; }

  if (typeof doc.id !== 'string' || !RUN_ID_RE.test(doc.id)) bad(`bad run id ${JSON.stringify(doc.id)} (expected R-NNN)`);
  else if (file !== `${doc.id}.json`) bad(`filename does not match id ${doc.id} (expected ${doc.id}.json)`);
  if (typeof doc.date !== 'string' || !validDate(doc.date)) bad(`bad date ${JSON.stringify(doc.date)} (expected YYYY-MM-DD)`);

  if (typeof doc.suite !== 'object' || doc.suite === null || Array.isArray(doc.suite) || Object.keys(doc.suite).length === 0) {
    bad('suite must be a non-empty object of <plugin>: <semver>');
  } else {
    for (const [plugin, ver] of Object.entries(doc.suite)) {
      if (!SLUG_RE.test(plugin)) bad(`suite key ${JSON.stringify(plugin)} is not a kebab slug`);
      if (typeof ver !== 'string' || !SEMVER_RE.test(ver)) bad(`suite.${plugin} is not a semver: ${JSON.stringify(ver)}`);
    }
  }

  const t = doc.target;
  if (typeof t !== 'object' || t === null) bad('target must be an object');
  else {
    if (typeof t.label !== 'string' || t.label.trim() === '') bad('target.label must be a non-empty string');
    if (typeof t.class !== 'string' || !SLUG_RE.test(t.class)) bad(`target.class must be a kebab slug: ${JSON.stringify(t.class)}`);
    if (typeof t.control !== 'boolean') bad('target.control must be a boolean');
  }

  if (!TRACKS.includes(doc.track)) bad(`track must be one of ${TRACKS.join('|')}: ${JSON.stringify(doc.track)}`);

  const q = doc.quality;
  if (typeof q !== 'object' || q === null) bad('quality must be an object');
  else {
    if (!isInt(q.findings) || q.findings < 0) bad('quality.findings must be a non-negative integer');
    if (!isInt(q.confirmed) || q.confirmed < 0) bad('quality.confirmed must be a non-negative integer');
    if (isInt(q.findings) && isInt(q.confirmed) && q.confirmed > q.findings) bad(`quality.confirmed (${q.confirmed}) exceeds quality.findings (${q.findings})`);
    const r = q.refutation;
    if (typeof r !== 'object' || r === null) bad('quality.refutation must be an object');
    else {
      for (const k of ['paneled', 'survived', 'reproExempt']) if (!isInt(r[k]) || r[k] < 0) bad(`quality.refutation.${k} must be a non-negative integer`);
      if (!isNullableInt(r.panelEligible)) bad('quality.refutation.panelEligible must be an integer or null');
      if (isInt(r.paneled) && isInt(r.survived) && r.survived > r.paneled) bad(`quality.refutation.survived (${r.survived}) exceeds paneled (${r.paneled})`);
    }
    if (q.severity !== null) {
      if (typeof q.severity !== 'object') bad('quality.severity must be an object or null');
      else for (const k of SEVERITY_KEYS) if (!isInt(q.severity[k]) || q.severity[k] < 0) bad(`quality.severity.${k} must be a non-negative integer`);
    }
  }

  const tk = doc.tokens;
  if (typeof tk !== 'object' || tk === null) bad('tokens must be an object');
  else {
    if (!isNullableInt(tk.operative)) bad('tokens.operative must be an integer or null');
    if (!isInt(tk.dispatches) || tk.dispatches < 0) bad('tokens.dispatches must be a non-negative integer');
  }

  const o = doc.orchestration;
  if (typeof o !== 'object' || o === null) bad('orchestration must be an object');
  else for (const k of ['dangling', 'failed', 'redispatched']) if (!isInt(o[k]) || o[k] < 0) bad(`orchestration.${k} must be a non-negative integer`);

  const s = doc.standardization;
  if (typeof s !== 'object' || s === null) bad('standardization must be an object');
  else {
    if (!isInt(s.enforcementsAdded) || s.enforcementsAdded < 0) bad('standardization.enforcementsAdded must be a non-negative integer');
    if (typeof s.tracelessClean !== 'boolean') bad('standardization.tracelessClean must be a boolean');
  }

  const c = doc.coverage;
  if (typeof c !== 'object' || c === null) bad('coverage must be an object');
  // Bounded non-negative like every sibling count group: `null` means not measured, but a
  // negative slice count is arithmetic that went wrong upstream, not a measurement.
  else for (const k of ['coveredNegatives', 'slicesSwept', 'slicesUnswept']) {
    if (!isNullableInt(c[k]) || (c[k] !== null && c[k] < 0)) bad(`coverage.${k} must be a non-negative integer or null`);
  }

  // `atlas` is OPTIONAL: runs recorded before the atlas leg existed have no such field, and a
  // doc without it validates unchanged. Present, it is bounded like every sibling count group —
  // a run cannot consume more sections than the atlas holds, nor falsify more than exist.
  if (doc.atlas !== undefined) {
    const al = doc.atlas;
    if (typeof al !== 'object' || al === null || Array.isArray(al)) bad('atlas, when present, must be an object');
    else {
      for (const k of ['sections', 'fresh', 'refreshed', 'falsified']) if (!isInt(al[k]) || al[k] < 0) bad(`atlas.${k} must be a non-negative integer`);
      if (isInt(al.sections) && isInt(al.fresh) && isInt(al.refreshed) && al.fresh + al.refreshed > al.sections) {
        bad(`atlas.fresh + atlas.refreshed (${al.fresh + al.refreshed}) exceeds atlas.sections (${al.sections})`);
      }
      if (isInt(al.sections) && isInt(al.falsified) && al.falsified > al.sections) bad(`atlas.falsified (${al.falsified}) exceeds atlas.sections (${al.sections})`);
    }
  }

  // `config` is OPTIONAL for the same reason as `atlas`: a run recorded before the tier
  // experiment did not record what it was driven under, and an absent field says exactly that —
  // never a default, since guessing a lead class would silently mis-group the comparison.
  if (doc.config !== undefined) {
    const cfg = doc.config;
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) bad('config, when present, must be an object');
    else {
      if (typeof cfg.lead !== 'string' || !CONFIG_LEAD_RE.test(cfg.lead)) bad('config.lead must be one or more plus-separated kebab model-class slugs');
      if (typeof cfg.operatives !== 'string' || !SLUG_RE.test(cfg.operatives)) bad('config.operatives must be a kebab model-class slug');
    }
  }

  // `host` is OPTIONAL for the same reason as `config`, and answers the sibling question:
  // `config` records WHICH MODEL drove the run, `host` records WHICH HARNESS. A lesson can
  // be a model's habit or a harness's mechanics, and without this field the two are
  // indistinguishable. Deliberately an open slug rather than a closed enum — a new host must
  // be recordable the day it ships, not after this file is edited.
  if (doc.host !== undefined) {
    if (typeof doc.host !== 'string' || !SLUG_RE.test(doc.host)) bad('host, when present, must be a kebab harness slug (for example claude-code, codex, grok-build, opencode)');
  }

  if (!Array.isArray(doc.lessons)) bad('lessons must be an array of lesson ids');
  else for (const l of doc.lessons) if (typeof l !== 'string' || !LESSON_ID_RE.test(l)) bad(`lessons entry ${JSON.stringify(l)} is not an L-NNN id`);

  if (typeof doc.notes !== 'string' || doc.notes.trim() === '') bad('notes must be a non-empty string');
}

function validateLessonNode(node, idx, problems) {
  const at = `lessons.json[${idx}]`;
  const bad = (reason) => problems.push(`schema: ${at}: ${reason}`);
  if (typeof node !== 'object' || node === null || Array.isArray(node)) { bad('lesson must be a JSON object'); return; }
  if (typeof node.id !== 'string' || !LESSON_ID_RE.test(node.id)) bad(`bad lesson id ${JSON.stringify(node.id)} (expected L-NNN)`);
  if (!LESSON_CLASSES.includes(node.class)) bad(`class must be one of ${LESSON_CLASSES.join('|')}: ${JSON.stringify(node.class)}`);
  if (typeof node.title !== 'string' || node.title.trim() === '') bad('title must be a non-empty string');
  if (typeof node.statement !== 'string' || node.statement.trim() === '') bad('statement must be a non-empty string');
  if (typeof node.firstSeen !== 'string' || !RUN_ID_RE.test(node.firstSeen)) bad(`firstSeen ${JSON.stringify(node.firstSeen)} is not an R-NNN id`);
}

// Strictly increasing serials, checked in file/array order: a gap is fine (an id may be retired)
// but a repeat or a step backwards means two authors numbered independently.
function checkMonotonic(ids, kind, problems) {
  let prev = 0;
  for (const id of ids) {
    const n = Number(id.slice(2));
    if (!Number.isFinite(n)) continue;
    if (n <= prev) problems.push(`non-monotonic: ${kind} id ${id} does not exceed the previous id (${kind.slice(0, 1).toUpperCase()}-${String(prev).padStart(3, '0')})`);
    prev = Math.max(prev, n);
  }
}

// An edge endpoint must RESOLVE, and each rel resolves against a different namespace — that is
// the whole point of the edge vocabulary. An EVAL:/GATE: target is checked against the working
// tree (an enforced-by pointing at a deleted eval is exactly the drift this catches); a GATE:
// target must also still contain its check slug.
function validateEdge(edge, ctx, problems) {
  const at = `edges.jsonl L${edge.line}`;
  const bad = (cls, reason) => problems.push(`${cls}: ${at}: ${reason}`);
  if (typeof edge.from !== 'string' || !LESSON_ID_RE.test(edge.from)) { bad('schema', `from ${JSON.stringify(edge.from)} is not an L-NNN id (an edge always starts at a lesson)`); return; }
  if (!ctx.lessonIds.has(edge.from)) { bad('dangling-edge', `from ${edge.from} is not a known lesson`); return; }
  if (!RELS.includes(edge.rel)) { bad('schema', `rel must be one of ${RELS.join('|')}: ${JSON.stringify(edge.rel)}`); return; }
  if (typeof edge.to !== 'string' || edge.to.trim() === '') { bad('schema', 'to must be a non-empty string'); return; }
  if ('note' in edge && (typeof edge.note !== 'string' || edge.note.trim() === '')) bad('schema', 'note, when present, must be a non-empty string');

  const to = edge.to;
  switch (edge.rel) {
    case 'fixed-in':
      if (!PR_ID_RE.test(to) && !COMMIT_ID_RE.test(to)) {
        bad('schema', `fixed-in target must be PR-NN with a numeric serial, or COMMIT:<7-40 lowercase hex>: ${JSON.stringify(to)}`);
      }
      break;
    case 'verified-in':
      // A verifying run need NOT re-surface the lesson: "the fix landed" is precisely the run
      // where it did not come back, so its `lessons` array is silent about it by design.
      if (!RUN_ID_RE.test(to)) bad('schema', `verified-in target must be R-NNN: ${JSON.stringify(to)}`);
      else if (!ctx.runIds.has(to)) bad('dangling-edge', `verified-in target ${to} is not a known run`);
      break;
    case 'supersedes':
      if (!LESSON_ID_RE.test(to)) bad('schema', `supersedes target must be L-NNN: ${JSON.stringify(to)}`);
      else if (!ctx.lessonIds.has(to)) bad('dangling-edge', `supersedes target ${to} is not a known lesson`);
      else if (to === edge.from) bad('schema', `${edge.from} cannot supersede itself`);
      break;
    case 'deferred':
      if (to !== 'deferred') bad('schema', `deferred target must be the literal string "deferred": ${JSON.stringify(to)}`);
      if (!('note' in edge)) bad('schema', 'a deferred edge requires a note saying why there is no mechanical home yet');
      break;
    case 'enforced-by': {
      const ev = EVAL_ID_RE.exec(to);
      const gt = GATE_ID_RE.exec(to);
      if (!ev && !gt) { bad('schema', `enforced-by target must be EVAL:<path> or GATE:<script>#<check-slug>: ${JSON.stringify(to)}`); break; }
      if (ev) {
        if (!existsSync(join(ctx.root, ev[1]))) bad('dangling-edge', `enforced-by target EVAL:${ev[1]} does not exist on disk — the eval that was supposed to hold ${edge.from} is gone`);
      } else {
        const scriptPath = join(ctx.root, gt[1]);
        if (!existsSync(scriptPath)) bad('dangling-edge', `enforced-by target GATE:${gt[1]} does not exist on disk`);
        else {
          let text = '';
          try { text = readFileSync(scriptPath, 'utf8'); } catch { /* unreadable == unresolved */ }
          if (!text.includes(gt[2])) bad('dangling-edge', `enforced-by target GATE:${gt[1]}#${gt[2]} — the check slug "${gt[2]}" no longer appears in ${gt[1]}`);
        }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- graph view (derived)

function buildGraph(store) {
  const runs = store.runs.map((r) => r.doc).filter((d) => d && typeof d.id === 'string');
  runs.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : String(a.date).localeCompare(String(b.date))));
  const runIds = new Set(runs.map((r) => r.id));
  const lessonIds = new Set(store.lessons.filter((l) => l && typeof l.id === 'string').map((l) => l.id));
  const lessonById = new Map(store.lessons.filter((l) => l && typeof l.id === 'string').map((l) => [l.id, l]));

  // surfaced-in / recurred-in are DERIVED here, off the run docs' own lessons arrays.
  const runsByLesson = new Map();
  for (const r of runs) {
    for (const l of Array.isArray(r.lessons) ? r.lessons : []) {
      if (!runsByLesson.has(l)) runsByLesson.set(l, []);
      if (!runsByLesson.get(l).includes(r.id)) runsByLesson.get(l).push(r.id);
    }
  }

  const edgesByLesson = new Map();
  const supersededBy = new Map();
  for (const e of store.edges) {
    if (typeof e.from !== 'string') continue;
    if (!edgesByLesson.has(e.from)) edgesByLesson.set(e.from, []);
    edgesByLesson.get(e.from).push(e);
    if (e.rel === 'supersedes' && typeof e.to === 'string') supersededBy.set(e.to, e.from);
  }

  return { runs, runIds, lessonIds, lessonById, runsByLesson, edgesByLesson, supersededBy, lessons: store.lessons };
}

const relsOf = (g, id, rel) => (g.edgesByLesson.get(id) ?? []).filter((e) => e.rel === rel);

// A lesson's derived status. Precedence matters: a superseded lesson is closed by its successor
// even with no fix of its own (L-006's shape), and a deferred lesson is closed-with-a-reason
// rather than open — otherwise "open" fills with items that were consciously parked.
function statusOf(g, id) {
  const fixedIn = relsOf(g, id, 'fixed-in');
  const enforcedBy = relsOf(g, id, 'enforced-by');
  const deferred = relsOf(g, id, 'deferred');
  const superseded = g.supersededBy.has(id);
  let status;
  if (superseded) status = 'SUPERSEDED';
  else if (fixedIn.length && enforcedBy.length) status = 'ENFORCED';
  else if (fixedIn.length) status = 'UNENFORCED';
  else if (deferred.length) status = 'DEFERRED';
  else status = 'OPEN';
  return { fixedIn, enforcedBy, deferred, superseded, status, runs: g.runsByLesson.get(id) ?? [] };
}

// ---------------------------------------------------------------- validate

function cmdValidate(args) {
  const f = parseFlags(args, new Set(['--store', '--root']));
  const root = resolve(f['--root'] ?? ROOT_DEFAULT);
  const storeDir = resolve(f['--store'] ?? join(root, 'evals', 'calibration'));
  const store = loadStore(storeDir);
  const problems = store.problems;

  for (const entry of store.runs) validateRunDoc(entry, problems);
  store.lessons.forEach((n, i) => validateLessonNode(n, i, problems));

  // Duplicate ids, checked before anything downstream trusts an id lookup.
  const seenRun = new Map();
  for (const { file, doc } of store.runs) {
    if (!doc || typeof doc.id !== 'string') continue;
    if (seenRun.has(doc.id)) problems.push(`duplicate-id: run ${doc.id} declared in both runs/${seenRun.get(doc.id)} and runs/${file}`);
    else seenRun.set(doc.id, file);
  }
  const seenLesson = new Set();
  for (const n of store.lessons) {
    if (!n || typeof n.id !== 'string') continue;
    if (seenLesson.has(n.id)) problems.push(`duplicate-id: lesson ${n.id} appears more than once in lessons.json`);
    seenLesson.add(n.id);
  }

  const g = buildGraph(store);
  checkMonotonic(g.runs.map((r) => r.id), 'run', problems);
  checkMonotonic(store.lessons.filter((n) => n && typeof n.id === 'string').map((n) => n.id), 'lesson', problems);

  // A run listing a lesson nobody defined, and the mirror case: a lesson no run ever listed.
  for (const r of g.runs) {
    for (const l of Array.isArray(r.lessons) ? r.lessons : []) {
      if (!g.lessonIds.has(l)) problems.push(`unknown-lesson: run ${r.id} lists ${l}, which is not defined in lessons.json`);
    }
  }
  for (const n of store.lessons) {
    if (!n || typeof n.id !== 'string') continue;
    const listedBy = g.runsByLesson.get(n.id) ?? [];
    if (listedBy.length === 0) problems.push(`orphan-lesson: ${n.id} is listed by no run — a lesson exists only because a run surfaced it`);
    else if (typeof n.firstSeen === 'string') {
      if (!g.runIds.has(n.firstSeen)) problems.push(`dangling-edge: lesson ${n.id} firstSeen ${n.firstSeen} is not a known run`);
      else if (!listedBy.includes(n.firstSeen)) problems.push(`unknown-lesson: lesson ${n.id} firstSeen ${n.firstSeen} does not list it (listed by ${listedBy.join(', ')})`);
      else if (listedBy[0] !== n.firstSeen) problems.push(`schema: lesson ${n.id} firstSeen ${n.firstSeen} is not its earliest run (earliest is ${listedBy[0]})`);
    }
  }

  const ctx = { root, lessonIds: g.lessonIds, runIds: g.runIds, runsByLesson: g.runsByLesson };
  for (const e of store.edges) validateEdge(e, ctx, problems);

  console.log(`# calibration-graph validate — ${storeDir}`);
  console.log(`  ${g.runs.length} run(s), ${store.lessons.length} lesson(s), ${store.edges.length} edge(s)`);
  for (const p of problems) console.log(`  !! ${p}`);
  console.log(`\n${problems.length} violation(s).`);
  if (problems.length) {
    console.error('Calibration-graph validation failed (fail-closed) — fix the store; never relax the check.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- render

const TABLE_HEADER = '| date | suite versions | target label | dispatches | CONFIRMED ratio | refutation survival | notes |';
const TABLE_RULE = '| --- | --- | --- | --- | --- | --- | --- |';

// Fixed preamble. It carries two jobs: the DERIVED-FILE rule (this file is regenerated, so a
// hand edit is drift that `render --check` will reject), and the one-way-channel rule inherited
// from the hand-maintained table it replaces — a run doc is fed only by a sanitized note that
// already passed the note validator, never by a hand-written row, and never with a target
// repo's name, path, or internals.
const PREAMBLE = `# Calibration trend table

**DERIVED — do not hand-edit.** Every row is rendered from the run documents under
\`evals/calibration/\` by \`node scripts/calibration-graph.mjs render\`; CI runs
\`render --check\` and fails on any drift. To change a cell, change the run document.

The trend SSOT for real-scale calibration runs (\`/code-ops-suite:calibration-run\`),
sibling to \`evals/FLOOR_TABLE.md\`. A run document is fed **only** by a sanitized
calibration note that has already passed \`scripts/calibration-metrics.mjs --validate-note\`
— never by a hand-written row, and never with a target repo's name, path, or internals.
See \`code-ops-docs/40 Engineering/Techniques/calibration-protocol.md\` for the one-way channel rule, the run
design, and the note template a run document is ingested from.
`;

const ratio2 = (n, d) => (d > 0 ? (n / d).toFixed(2) : null);

const suiteCell = (suite) => Object.entries(suite).map(([p, v]) => `${p}@${v}`).join(', ');

const confirmedCell = (q) => {
  const r = ratio2(q.confirmed, q.findings);
  return `${r ?? 'n/a'} (${q.confirmed} of ${q.findings})`;
};

const survivalCell = (r) => {
  const v = ratio2(r.survived, r.paneled);
  const exempt = r.reproExempt > 0 ? `; ${r.reproExempt} repro-exempt` : '';
  if (v === null) return `n/a (0 paneled${exempt})`;
  return `${v} (${r.survived} of ${r.paneled} paneled${exempt})`;
};

function renderTable(g) {
  const rows = g.runs.map((r) => `| ${r.date} | ${suiteCell(r.suite)} | ${r.target.label} | ${r.tokens.dispatches} `
    + `| ${confirmedCell(r.quality)} | ${survivalCell(r.quality.refutation)} | ${r.notes} |`);
  return `${PREAMBLE}\n${TABLE_HEADER}\n${TABLE_RULE}\n${rows.join('\n')}\n`;
}

function cmdRender(args) {
  const f = parseFlags(args, new Set(['--store', '--table', '--root']), new Set(['--check']));
  const root = resolve(f['--root'] ?? ROOT_DEFAULT);
  const storeDir = resolve(f['--store'] ?? join(root, 'evals', 'calibration'));
  const tablePath = resolve(f['--table'] ?? join(root, 'evals', 'CALIBRATION_TABLE.md'));
  const store = loadStore(storeDir);
  if (store.problems.length) {
    console.error('x refusing to render from a store that does not parse:');
    for (const p of store.problems) console.error(`  !! ${p}`);
    process.exit(1);
  }
  const g = buildGraph(store);
  const rendered = renderTable(g);

  if (f['--check']) {
    const actual = existsSync(tablePath) ? readFileSync(tablePath, 'utf8') : null;
    if (actual === null) {
      console.error(`x --check: ${tablePath} is missing — run \`node scripts/calibration-graph.mjs render\``);
      process.exit(1);
    }
    if (actual !== rendered) {
      console.error(`x --check: ${tablePath} drifted from evals/calibration/ — it is a DERIVED file; re-run`
        + ' `node scripts/calibration-graph.mjs render` and commit the result instead of hand-editing it.');
      const a = actual.split('\n'); const b = rendered.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { console.error(`  first differing line ${i + 1}:\n    on disk:  ${String(a[i]).slice(0, 160)}\n    rendered: ${String(b[i]).slice(0, 160)}`); break; }
      }
      process.exit(1);
    }
    console.log(`(calibration-graph) ${g.runs.length} run(s) — CALIBRATION_TABLE.md is up to date.`);
    return;
  }

  mkdirSync(dirname(tablePath), { recursive: true });
  writeFileSync(tablePath, rendered);
  console.log(`(calibration-graph) rendered ${g.runs.length} run(s) -> ${tablePath}`);
}

// ---------------------------------------------------------------- query

const titleOf = (g, id) => g.lessonById.get(id)?.title ?? '(undefined lesson)';

function cmdQuery(args) {
  const f = parseFlags(args, new Set(['--store', '--root']), new Set(['--gate']));
  const sub = f._[0];
  if (!sub) { console.error('x query needs a subcommand'); usage(); }
  const root = resolve(f['--root'] ?? ROOT_DEFAULT);
  const storeDir = resolve(f['--store'] ?? join(root, 'evals', 'calibration'));
  const store = loadStore(storeDir);
  if (store.problems.length) {
    console.error('x refusing to query a store that does not parse — run `validate` first:');
    for (const p of store.problems) console.error(`  !! ${p}`);
    process.exit(1);
  }
  const g = buildGraph(store);
  // Read the ids off the already-defended graph view, not off the raw array: a store that parses
  // but holds a malformed lesson entry must get a clean answer (or validate's refusal), never a
  // TypeError from a null node. `validate` stays the gate; `query` just must not throw.
  const ids = [...g.lessonIds];
  let red = 0;

  if (sub === 'open') {
    // OPEN means genuinely unaddressed: no fix, no conscious deferral, no successor lesson.
    const hits = ids.filter((id) => statusOf(g, id).status === 'OPEN');
    console.log('# open lessons (no fixed-in, no deferred, not superseded)');
    for (const id of hits) { console.log(`  RED  ${id}  ${titleOf(g, id)}`); red++; }
    if (!hits.length) console.log('  (none)');
    console.log(`\n${hits.length} open lesson(s).`);
  } else if (sub === 'deferred') {
    const hits = ids.filter((id) => statusOf(g, id).status === 'DEFERRED');
    console.log('# deferred lessons (parked with a reason, no mechanical home yet)');
    for (const id of hits) {
      const why = statusOf(g, id).deferred.map((e) => e.note).filter(Boolean).join('; ');
      console.log(`  ${id}  ${titleOf(g, id)} — ${why}`);
    }
    if (!hits.length) console.log('  (none)');
    console.log(`\n${hits.length} deferred lesson(s).`);
  } else if (sub === 'unenforced') {
    const hits = ids.filter((id) => statusOf(g, id).status === 'UNENFORCED');
    console.log('# unenforced lessons (fixed-in with no enforced-by)');
    for (const id of hits) {
      const prs = statusOf(g, id).fixedIn.map((e) => e.to).join(', ');
      console.log(`  RED  ${id}  ${titleOf(g, id)}  (fixed-in ${prs}, nothing mechanical holds it)`);
      red++;
    }
    if (!hits.length) console.log('  (none)');
    console.log(`\n${hits.length} unenforced lesson(s).`);
  } else if (sub === 'unverified') {
    // The store's weakest link, by its own numbers: `fixed-in` says a change shipped and
    // `enforced-by` says a gate holds it, but only `verified-in` says a LATER RUN observed
    // the fix actually holding in the field. Shipping is not landing. Without this list a
    // run has no worklist of prior fixes to confirm, so the loop measures its own output
    // instead of its own effect — which is how 23 fixes accumulated behind 3 verifications.
    const hits = ids.filter((id) => {
      const st = statusOf(g, id);
      if (st.superseded || !st.fixedIn.length) return false;
      return relsOf(g, id, 'verified-in').length === 0;
    });
    console.log('# unverified fixes (shipped, but no later run has confirmed the fix held)');
    for (const id of hits) {
      const st = statusOf(g, id);
      const where = st.fixedIn.map((e) => e.to).join(', ');
      // RED only when nothing mechanical holds it either: an enforced fix has a gate
      // standing in for field evidence, an unenforced one has nothing at all.
      const isRed = !st.enforcedBy.length;
      if (isRed) red++;
      console.log(`  ${isRed ? 'RED ' : 'ok  '} ${id}  ${st.status}  (fixed-in ${where}${st.enforcedBy.length ? `, ${st.enforcedBy.length} gate(s)` : ', nothing mechanical'})  ${titleOf(g, id)}`);
    }
    if (!hits.length) console.log('  (none — every shipped fix has been confirmed by a later run)');
    const verified = ids.filter((id) => relsOf(g, id, 'verified-in').length > 0).length;
    console.log(`\n${hits.length} unverified fix(es); ${verified} lesson(s) confirmed by a later run.`);
  } else if (sub === 'recurrent') {
    // Recurrence is the load-bearing signal: a lesson a second run had to relearn. RED only when
    // it ALSO has nothing mechanical holding it — that pairing is why it came back.
    const hits = ids.filter((id) => (g.runsByLesson.get(id) ?? []).length >= 2);
    console.log('# recurrent lessons (listed by >=2 runs; RED when also unenforced)');
    for (const id of hits) {
      const st = statusOf(g, id);
      const isRed = st.status === 'UNENFORCED' || st.status === 'OPEN';
      if (isRed) red++;
      console.log(`  ${isRed ? 'RED ' : 'ok  '} ${id}  ${st.runs.length} runs (${st.runs.join(', ')})  ${st.status}  ${titleOf(g, id)}`);
    }
    if (!hits.length) console.log('  (none)');
    console.log(`\n${hits.length} recurrent lesson(s), ${red} RED.`);
  } else if (sub === 'trend') {
    // Grouped by target class AND track: comparing a CONFIRMED ratio across tracks compares two
    // different things (L-012 restated the rule, but the grouping is what makes it visible).
    console.log('# calibration trend (grouped by target class and track; one line per run)');
    const groups = new Map();
    for (const r of g.runs) {
      const key = `${r.target.class} / ${r.track}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, rs] of groups) {
      console.log(`\n## ${key}${rs.some((r) => r.target.control) ? '  (control)' : ''}`);
      for (const r of rs) {
        const q = r.quality;
        const per100k = r.tokens.operative ? (q.confirmed / (r.tokens.operative / 100000)).toFixed(2) : 'n/a';
        // The atlas tail prints only for a run that measured one — a run with no atlas leg says
        // nothing here rather than showing zeros that would read as "an atlas nobody used".
        const atlas = r.atlas ? `  atlas ${r.atlas.fresh} fresh, ${r.atlas.refreshed} refreshed, ${r.atlas.falsified} falsified of ${r.atlas.sections}` : '';
        // Same rule as the atlas tail: only a run that recorded its orchestration says anything
        // here, so the tier experiment's arms are told apart by what they recorded, not inferred.
        const config = r.config ? `  config ${r.config.lead}->${r.config.operatives}` : '';
        // Same silence rule as atlas and config: a run that recorded no harness says nothing
        // here rather than being shown as some default one.
        const host = r.host ? `  host ${r.host}` : '';
        console.log(`  ${r.id}  ${r.date}  findings ${q.findings}  confirmed ${q.confirmed} (${ratio2(q.confirmed, q.findings) ?? 'n/a'})`
          + `  confirmed/100k ${per100k}  survival ${survivalCell(q.refutation)}  dispatches ${r.tokens.dispatches}${atlas}${config}${host}`);
      }
    }
    console.log(`\n${g.runs.length} run(s) across ${groups.size} class/track group(s).`);
  } else if (sub === 'cross-model') {
    // The question this answers: which lessons are the SUITE's problem, and which are one
    // model's? A lesson two providers independently relearned cannot be explained by one
    // model's habits, so it belongs in the skill text or the conventions. A lesson only one
    // provider ever hit is a host adaptation until a second provider corroborates it —
    // fixing the suite for it risks over-fitting the doctrine to a single model.
    //
    // Attribution comes from each run's own recorded config line. A run that recorded none
    // contributes to no provider, exactly as the atlas and config tails elsewhere stay
    // silent rather than defaulting: "nobody recorded it" must not read as a provider.
    const providersOfRun = new Map();
    for (const r of g.runs) {
      const set = new Set();
      // A split lead names every class that held the session, so each one attributes. Guard the
      // split on the string type, not just presence: a schema-invalid store (array lead) reaches
      // this reader, and it must stay non-throwing exactly as providerOfConfigSlug is.
      const leadSlugs = typeof r.config?.lead === 'string' ? r.config.lead.split('+') : [];
      for (const slug of [...leadSlugs, r.config?.operatives]) {
        const provider = providerOfConfigSlug(slug);
        if (provider) set.add(provider);
      }
      providersOfRun.set(r.id, set);
    }

    console.log('# cross-model corroboration (provider spread per lesson, derived from run config lines)');
    console.log('\n## runs by provider');
    const runsByProvider = new Map();
    const unattributedRuns = [];
    for (const r of g.runs) {
      const set = providersOfRun.get(r.id);
      if (!set.size) { unattributedRuns.push(r.id); continue; }
      for (const provider of set) {
        if (!runsByProvider.has(provider)) runsByProvider.set(provider, []);
        runsByProvider.get(provider).push(r.id);
      }
    }
    for (const provider of [...runsByProvider.keys()].sort()) {
      const rs = runsByProvider.get(provider);
      console.log(`  ${provider.padEnd(12)} ${rs.length} run(s) (${rs.join(', ')})`);
    }
    if (unattributedRuns.length) console.log(`  ${'(none)'.padEnd(12)} ${unattributedRuns.length} run(s) with no config line (${unattributedRuns.join(', ')})`);
    if (!runsByProvider.size) console.log('  (no run records a config line yet)');

    // The second axis. `config` says which MODEL drove the run; `host` says which HARNESS.
    // A lesson can be a model's habit or a harness's mechanics, and only these two together
    // separate "the suite is wrong" from "this particular setup is wrong".
    console.log('\n## runs by host');
    const runsByHost = new Map();
    const hostlessRuns = [];
    for (const r of g.runs) {
      if (!r.host) { hostlessRuns.push(r.id); continue; }
      if (!runsByHost.has(r.host)) runsByHost.set(r.host, []);
      runsByHost.get(r.host).push(r.id);
    }
    for (const host of [...runsByHost.keys()].sort()) {
      console.log(`  ${host.padEnd(12)} ${runsByHost.get(host).length} run(s) (${runsByHost.get(host).join(', ')})`);
    }
    if (hostlessRuns.length) console.log(`  ${'(none)'.padEnd(12)} ${hostlessRuns.length} run(s) with no host line (${hostlessRuns.join(', ')})`);
    if (!runsByHost.size) console.log('  (no run records a host line yet — the suite cannot yet tell a harness quirk from a suite defect)');

    console.log('\n## lessons');
    let crossModel = 0;
    let singleProvider = 0;
    let unattributed = 0;
    for (const id of ids) {
      const runs = g.runsByLesson.get(id) ?? [];
      const providers = new Set();
      const hosts = new Set();
      for (const runId of runs) {
        for (const provider of providersOfRun.get(runId) ?? []) providers.add(provider);
        const host = g.runs.find((r) => r.id === runId)?.host;
        if (host) hosts.add(host);
      }
      const st = statusOf(g, id);
      const unheld = st.status === 'OPEN' || st.status === 'UNENFORCED';
      // Either axis crossing is enough to call it the suite's problem: a lesson two models
      // relearned is not one model's habit, and one two harnesses relearned is not one
      // harness's mechanics.
      const spread = [
        providers.size ? `providers: ${[...providers].sort().join(', ')}` : null,
        hosts.size ? `hosts: ${[...hosts].sort().join(', ')}` : null,
      ].filter(Boolean).join(' | ');
      if (providers.size >= 2 || hosts.size >= 2) {
        crossModel++;
        // A cross-cutting lesson with nothing mechanical holding it is the highest-value
        // repair in the store: every provider and host keeps paying for it, every run.
        if (unheld) red++;
        console.log(`  ${unheld ? 'RED ' : 'ok  '} CROSS-MODEL  ${id}  ${runs.length} run(s)  ${st.status}  [${spread}]  ${titleOf(g, id)}`);
      } else if (providers.size === 1) {
        singleProvider++;
      } else {
        unattributed++;
      }
    }
    if (!crossModel) console.log('  (no lesson has yet recurred under two providers)');

    console.log(`\n${crossModel} cross-model lesson(s) — fix these in the suite; ${singleProvider} single-provider (host adaptation until corroborated); ${unattributed} unattributed (cited only by runs with no config line).`);
  } else if (sub === 'lesson') {
    const id = f._[1];
    if (!id) { console.error('x query lesson needs an L-NNN id'); usage(); }
    const node = g.lessonById.get(id);
    if (!node) { console.error(`x unknown lesson: ${id}`); process.exit(1); }
    const st = statusOf(g, id);
    console.log(`# ${node.id}  ${node.title}`);
    console.log(`  class: ${node.class}`);
    console.log(`  first seen: ${node.firstSeen}`);
    console.log(`  statement: ${node.statement}`);
    console.log(`  runs (${st.runs.length}): ${st.runs.join(', ') || '(none)'}`);
    console.log('  edges:');
    const out = g.edgesByLesson.get(id) ?? [];
    for (const e of out) console.log(`    ${e.rel.padEnd(12)} ${e.to}${e.note ? `  — ${e.note}` : ''}`);
    const succ = g.supersededBy.get(id);
    if (succ) console.log(`    superseded-by ${succ}  (derived from ${succ}'s supersedes edge)`);
    if (!out.length && !succ) console.log('    (none)');
    console.log(`  derived status: ${st.status}  (recurrent: ${st.runs.length >= 2 ? 'yes' : 'no'})`);
    if (st.status === 'OPEN' || st.status === 'UNENFORCED') red++;
  } else {
    console.error(`x unknown query subcommand: ${sub}`);
    usage();
  }

  if (red && f['--gate']) {
    console.error(`--gate: ${red} RED line(s) — a lesson with nothing mechanical holding it is how it recurs.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- ingest

// Machine block grammar (code-ops-docs/40 Engineering/Techniques/calibration-protocol.md's note template). Line-based
// on purpose: no fences, no paths, only counts, kebab slugs and enum words, so the block adds
// no leak surface to the one-way channel while still being machine-readable.
const MACHINE_HEADING_RE = /^##\s+Machine block\s*$/i;
const NEXT_HEADING_RE = /^#{1,6}\s+/;

const SHAPES = [
  ['run-date', /^run-date:\s*(\d{4}-\d{2}-\d{2})$/],
  ['suite', /^suite:\s*([a-z0-9-]+@\d+\.\d+\.\d+(?:\s*,\s*[a-z0-9-]+@\d+\.\d+\.\d+)*)$/],
  ['target-class', /^target-class:\s*([a-z0-9]+(?:-[a-z0-9]+)*);\s*control:\s*(yes|no)$/],
  ['track', /^track:\s*(assess-only|implement)$/],
  ['findings', /^findings:\s*(\d+);\s*confirmed:\s*(\d+)$/],
  ['paneled', /^paneled:\s*(\d+) of (\d+|unknown) eligible;\s*survived:\s*(\d+);\s*repro-exempt:\s*(\d+)$/],
  ['severity', /^severity:\s*(?:c\/h\/m\/l\/n as (\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)|unknown)$/],
  ['tokens', /^tokens:\s*(\d+|unknown) operative;\s*dispatches:\s*(\d+)$/],
  ['orchestration', /^orchestration:\s*dangling (\d+);\s*failed (\d+);\s*redispatched (\d+)$/],
  ['standardization', /^standardization:\s*enforcements (\d+);\s*traceless (clean|dirty)$/],
  ['coverage', /^coverage:\s*(?:covered-negatives (\d+);\s*slices swept (\d+) of (\d+)|unknown)$/],
  // OPTIONAL — absent from REQUIRED_KEYS on purpose: R-001..R-003 predate the atlas leg, and a
  // target with no atlas at all still produces a valid note.
  ['atlas', /^atlas:\s*sections (\d+);\s*fresh (\d+);\s*refreshed (\d+);\s*falsified (\d+)$/],
  // OPTIONAL for the same reason as the atlas line, and likewise absent from REQUIRED_KEYS:
  // R-001..R-004 predate the tier experiment, so a note without it ingests unchanged.
  ['config', /^config:\s*lead ([a-z0-9]+(?:-[a-z0-9]+)*(?:\+[a-z0-9]+(?:-[a-z0-9]+)*)*);\s*operatives ([a-z0-9]+(?:-[a-z0-9]+)*)$/],
  // OPTIONAL, and absent from REQUIRED_KEYS like atlas and config: runs before the suite went
  // multi-host recorded no harness, and that must stay ingestable unchanged.
  ['host', /^host:\s*([a-z0-9]+(?:-[a-z0-9]+)*)$/],
  ['lesson-recur', /^lesson:\s*recur (L-\d{3})$/],
  ['lesson-new', /^lesson:\s*new (instrument|suite|protocol) — (\S.*)$/],
];

const REQUIRED_KEYS = ['run-date', 'suite', 'target-class', 'track', 'findings', 'paneled', 'severity', 'tokens', 'orchestration', 'standardization', 'coverage'];

// Returns { fields, lessonsRecur, lessonsNew, problems }. A line inside the block that matches no
// shape is a REFUSAL, not a skip: a typo'd metric line would otherwise silently ingest as absent.
function parseMachineBlock(text) {
  const problems = [];
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => MACHINE_HEADING_RE.test(l.trim()));
  if (start === -1) return { problems: ['note is missing its "## Machine block" section (template version too old — regenerate the note)'] };
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_HEADING_RE.test(lines[i])) break;
    body.push({ text: lines[i].trim(), lineNo: i + 1 });
  }
  const fields = new Map();
  const lessonsRecur = [];
  const lessonsNew = [];
  for (const { text: line, lineNo } of body) {
    if (line === '') continue;
    const hit = SHAPES.find(([, re]) => re.test(line));
    if (!hit) { problems.push(`L${lineNo}: line matches no Machine-block shape: ${line.slice(0, 120)}`); continue; }
    const [key, re] = hit;
    const m = re.exec(line);
    if (key === 'lesson-recur') { lessonsRecur.push(m[1]); continue; }
    if (key === 'lesson-new') { lessonsNew.push({ class: m[1], statement: m[2].trim() }); continue; }
    if (fields.has(key)) { problems.push(`L${lineNo}: duplicate "${key}" line`); continue; }
    fields.set(key, m);
  }
  for (const k of REQUIRED_KEYS) if (!fields.has(k)) problems.push(`missing required Machine-block line: ${k}`);
  return { fields, lessonsRecur, lessonsNew, problems };
}

const nextSerial = (ids, prefix) => {
  let max = 0;
  for (const id of ids) { const n = Number(id.slice(2)); if (Number.isFinite(n)) max = Math.max(max, n); }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

// The note's Lessons prose becomes the run doc's notes cell (the schema's own rule for a new
// run). Absent, the field is a named placeholder rather than an empty string, so the run doc
// still validates and the gap is visible in the rendered table.
function lessonsProse(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => /^##\s+Lessons\s*$/i.test(l.trim()));
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_HEADING_RE.test(lines[i])) break;
    const t = lines[i].trim().replace(/^[-*]\s+/, '');
    if (t !== '') body.push(t);
  }
  return body.length ? body.join(' ') : null;
}

function cmdIngest(args) {
  const f = parseFlags(args, new Set(['--note', '--store', '--root', '--id', '--label']));
  if (!('--note' in f)) { console.error('x ingest needs --note <file>'); usage(); }
  const root = resolve(f['--root'] ?? ROOT_DEFAULT);
  const storeDir = resolve(f['--store'] ?? join(root, 'evals', 'calibration'));
  const notePath = resolve(f['--note']);
  if (!existsSync(notePath)) { console.error(`x note not found: ${notePath}`); process.exit(2); }
  let noteText;
  try { noteText = readFileSync(notePath, 'utf8'); }
  catch (e) { console.error(`x cannot read note ${notePath}: ${e.message}`); process.exit(2); }

  const store = loadStore(storeDir);
  if (store.problems.length) {
    console.error('x refusing to ingest into a store that does not parse — run `validate` first:');
    for (const p of store.problems) console.error(`  !! ${p}`);
    process.exit(1);
  }
  const g = buildGraph(store);

  const { fields, lessonsRecur, lessonsNew, problems } = parseMachineBlock(noteText);
  if (problems.length) {
    console.error(`x Machine block rejected — ${problems.length} problem(s) in ${notePath}:`);
    for (const p of problems) console.error(`  !! ${p}`);
    console.error('Fail-closed: an ingest that guesses at a malformed metric line writes a wrong row forever.');
    process.exit(1);
  }
  for (const id of lessonsRecur) {
    if (!g.lessonIds.has(id)) {
      console.error(`x Machine block says "lesson: recur ${id}" but ${id} is not defined in lessons.json — a recurrence must point at an existing lesson.`);
      process.exit(1);
    }
  }

  const runId = f['--id'] ?? nextSerial([...g.runIds], 'R');
  if (!RUN_ID_RE.test(runId)) { console.error(`x --id must be R-NNN: ${runId}`); process.exit(2); }
  const runPath = join(storeDir, 'runs', `${runId}.json`);
  if (existsSync(runPath)) {
    console.error(`x refusing to overwrite an existing run document: runs/${runId}.json — a calibration run is`
      + ' append-only history; re-ingesting over it would erase the row it already rendered.');
    process.exit(1);
  }

  // Assign ids to the new lessons before building the run doc, so its lessons array is complete.
  const allLessonIds = [...g.lessonIds];
  const minted = [];
  for (const nl of lessonsNew) {
    const id = nextSerial(allLessonIds, 'L');
    allLessonIds.push(id);
    // The Machine block carries one statement sentence; the title is its leading clause, which is
    // how the backfilled lessons read too. Both stay editable afterwards.
    const title = nl.statement.split(/[.;]\s/)[0].trim().replace(/\.$/, '');
    minted.push({ id, class: nl.class, title, statement: nl.statement, firstSeen: runId });
  }

  const suite = {};
  for (const tok of fields.get('suite')[1].split(',').map((s) => s.trim())) {
    const at = tok.lastIndexOf('@');
    suite[tok.slice(0, at)] = tok.slice(at + 1);
  }
  const tc = fields.get('target-class');
  const fd = fields.get('findings');
  const pn = fields.get('paneled');
  const sv = fields.get('severity');
  const tk = fields.get('tokens');
  const or = fields.get('orchestration');
  const sd = fields.get('standardization');
  const cv = fields.get('coverage');
  // `slices swept N of M` with N > M derives a negative unswept remainder. Refuse it here, at
  // parse time, with a named reason: the note itself is wrong, and a run doc built from it would
  // only fail the schema check below with a less useful message.
  if (cv[1] !== undefined && Number(cv[2]) > Number(cv[3])) {
    console.error(`x Machine block rejected — coverage line says "slices swept ${cv[2]} of ${cv[3]}": swept exceeds`
      + ' the total slice inventory, which would derive a negative unswept remainder.');
    console.error('Fail-closed: an ingest that guesses at a malformed metric line writes a wrong row forever.');
    process.exit(1);
  }
  // Same class of arithmetic refusal as the coverage line above, for the same reason: an atlas
  // line that consumes or falsifies more sections than it declares is a wrong note, and a run
  // doc built from it would only fail the schema check below with a less useful message.
  const al = fields.get('atlas');
  if (al && (Number(al[2]) + Number(al[3]) > Number(al[1]) || Number(al[4]) > Number(al[1]))) {
    console.error(`x Machine block rejected — atlas line declares ${al[1]} section(s) but reports ${al[2]} fresh,`
      + ` ${al[3]} refreshed and ${al[4]} falsified: a run cannot consume or falsify more sections than the atlas holds.`);
    console.error('Fail-closed: an ingest that guesses at a malformed metric line writes a wrong row forever.');
    process.exit(1);
  }
  // No arithmetic bound to check on the config line — it carries slugs, not counts, and the shape
  // above is the whole contract. Bound here only so the doc assembly below reads like its siblings.
  const cf = fields.get('config');
  const ht = fields.get('host');
  const num = (v) => (v === undefined || v === 'unknown' ? null : Number(v));

  const label = f['--label'] ?? `TODO: sanitized prose label for ${tc[1]}`;
  const notes = lessonsProse(noteText) ?? `TODO: lessons prose for ${runId}`;

  const doc = {
    id: runId,
    date: fields.get('run-date')[1],
    suite,
    target: { label, class: tc[1], control: tc[2] === 'yes' },
    track: fields.get('track')[1],
    quality: {
      findings: Number(fd[1]),
      confirmed: Number(fd[2]),
      refutation: { paneled: Number(pn[1]), survived: Number(pn[3]), reproExempt: Number(pn[4]), panelEligible: num(pn[2]) },
      severity: sv[1] === undefined ? null : { critical: Number(sv[1]), high: Number(sv[2]), medium: Number(sv[3]), low: Number(sv[4]), nit: Number(sv[5]) },
    },
    tokens: { operative: num(tk[1]), dispatches: Number(tk[2]) },
    orchestration: { dangling: Number(or[1]), failed: Number(or[2]), redispatched: Number(or[3]) },
    standardization: { enforcementsAdded: Number(sd[1]), tracelessClean: sd[2] === 'clean' },
    coverage: cv[1] === undefined
      ? { coveredNegatives: null, slicesSwept: null, slicesUnswept: null }
      : { coveredNegatives: Number(cv[1]), slicesSwept: Number(cv[2]), slicesUnswept: Number(cv[3]) - Number(cv[2]) },
    // Omitted entirely when the note carries no atlas line — an absent field reads as "this run
    // had no atlas leg", which a zeroed object would not.
    ...(al ? { atlas: { sections: Number(al[1]), fresh: Number(al[2]), refreshed: Number(al[3]), falsified: Number(al[4]) } } : {}),
    // Omitted entirely when the note carries no config line, for the same reason as atlas above:
    // "nobody recorded the orchestration" must not be storable as some default configuration.
    ...(cf ? { config: { lead: cf[1], operatives: cf[2] } } : {}),
    // Omitted when the note carries no host line, same rule again: an unrecorded harness must
    // not become a default one, or every pre-existing run would read as Claude Code.
    ...(ht ? { host: ht[1] } : {}),
    lessons: [...lessonsRecur, ...minted.map((m) => m.id)],
    notes,
  };

  // Validate the skeleton BEFORE writing: a doc that would fail `validate` must never land.
  const shapeProblems = [];
  validateRunDoc({ file: `${runId}.json`, doc }, shapeProblems);
  minted.forEach((m, i) => validateLessonNode(m, i, shapeProblems));
  if (shapeProblems.length) {
    console.error(`x the run document the Machine block produced does not satisfy the schema — nothing written:`);
    for (const p of shapeProblems) console.error(`  !! ${p}`);
    process.exit(1);
  }

  mkdirSync(join(storeDir, 'runs'), { recursive: true });
  writeFileSync(runPath, JSON.stringify(doc, null, 2) + '\n');
  if (minted.length) {
    writeFileSync(join(storeDir, 'lessons.json'), JSON.stringify([...store.lessons, ...minted], null, 2) + '\n');
  }

  console.log(`(calibration-graph) ingested ${runId} -> runs/${runId}.json`);
  console.log(`  recurred: ${lessonsRecur.join(', ') || '(none)'}`);
  console.log(`  new lessons: ${minted.map((m) => `${m.id} (${m.class})`).join(', ') || '(none)'}`);
  const todo = [];
  if (!('--label' in f)) todo.push('target.label');
  if (notes.startsWith('TODO:')) todo.push('notes');
  if (todo.length) console.log(`  !! skeleton: fill in ${todo.join(', ')} by hand, then run validate + render.`);
  console.log('  next: node scripts/calibration-graph.mjs validate && node scripts/calibration-graph.mjs render');
}

// ---------------------------------------------------------------- dispatch

const argv = process.argv.slice(2);
if (argv[0] === 'validate') cmdValidate(argv.slice(1));
else if (argv[0] === 'render') cmdRender(argv.slice(1));
else if (argv[0] === 'query') cmdQuery(argv.slice(1));
else if (argv[0] === 'ingest') cmdIngest(argv.slice(1));
else usage();
