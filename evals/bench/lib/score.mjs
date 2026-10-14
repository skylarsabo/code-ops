// Scoring for the beat-the-bare-model benchmark (design: code-ops-docs/10 Design/Beat the bare
// model benchmark 2026-10.md; shapes: code-ops-docs/80 Runs/2026-10-14-bench-design/units/
// STEP4_SHAPES.md). Pure functions over per-unit results and the derived answer key. The one
// I/O is `proofIssue`, which reads the sandbox to resolve a finding's proof.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const EPS = 1e-9;

/** Guard bounds, cost caps, and instrument thresholds from the design (Guard metrics, Verdict rule). */
export const BOUNDS = {
  inflation: 0.05,
  decoy: 0.5,
  unkeyedRatio: 1.5,
  costRatio: 4.0,
  wallRatio: 4.0,
  saturation: 0.9,
  voidShare: 0.25,
};

const DETECTION = new Set(['rigor:bug-hunt', 'rigor:deep-review', 'code-ops-suite:codebase-audit']);
const REGRESSION_SKILLS = new Set(['code-ops-suite:debug', 'code-ops-suite:ship', 'code-ops-suite:codebase-audit']);
const GUARDS = ['inflation', 'decoy', 'regressions', 'falseBlocks', 'unkeyed'];
const VERDICTS = {
  instrument: 'INCONCLUSIVE (instrument)',
  keep: 'KEEP',
  fixGuard: 'FIX (cost or guard)',
  fixValue: 'FIX (guard value)',
  retire: 'RETIRE candidate',
  power: 'INCONCLUSIVE (power)',
};

/** The primary-metric kind of a skill: f05 (detection), resolved (debug), or accepted (ship). */
function metricKind(skill) {
  if (DETECTION.has(skill)) return 'f05';
  if (skill === 'code-ops-suite:debug') return 'resolved';
  if (skill === 'code-ops-suite:ship') return 'accepted';
  throw new Error(`unknown skill: ${skill}`);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ---- matching ---------------------------------------------------------------------------

const normPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);

/** True when one path is the other or a path-boundary suffix of it, with equal basenames. */
function samePath(a, b) {
  const x = normPath(a);
  const y = normPath(b);
  if (!x || !y || baseName(x) !== baseName(y)) return false;
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/**
 * Match findings to the derived key. A finding matches an entry when the paths agree by suffix and
 * basename and |line - entry.line| <= lineTolerance. A finding that matches a decoy (alone or
 * together with a defect) is a decoy hit; one that matches only a defect hits that defect; one
 * that matches nothing is unkeyed. Returns distinct hit ids and a per-finding verdict.
 */
export function matchFindings(findings, derivedKey) {
  const tol = derivedKey.lineTolerance ?? 3;
  const entries = derivedKey.entries ?? [];
  const defects = new Set();
  const decoys = new Set();
  const perFinding = [];
  let unkeyed = 0;
  (findings ?? []).forEach((f, index) => {
    const line = Number(f?.line);
    const near = Number.isFinite(line) && f
      ? entries.filter((e) => samePath(f.file, e.file) && Math.abs(line - e.line) <= tol)
        .sort((a, b) => Math.abs(line - a.line) - Math.abs(line - b.line))
      : [];
    const decoy = near.find((e) => e.kind === 'decoy');
    const defect = near.find((e) => e.kind === 'defect');
    if (decoy) {
      decoys.add(decoy.id);
      perFinding.push({ index, kind: 'decoy', id: decoy.id, ambiguous: Boolean(defect) });
    } else if (defect) {
      defects.add(defect.id);
      perFinding.push({ index, kind: 'defect', id: defect.id, ambiguous: false });
    } else {
      unkeyed += 1;
      perFinding.push({ index, kind: 'unkeyed', id: null, ambiguous: false });
    }
  });
  return { defects: [...defects], decoys: [...decoys], unkeyed, perFinding };
}

/** Keyed F0.5. Zero when there are no hits, so an empty unit never divides by zero. */
export function f05(tp, fp, fn) {
  if (!(tp > 0)) return 0;
  const p = tp / (tp + fp);
  const r = tp / (tp + fn);
  return (1.25 * p * r) / (0.25 * p + r);
}

// ---- per-unit scoring -------------------------------------------------------------------

/**
 * Score one unit result against its derived key. `primary` is null when the unit is void or is
 * the clean deep-review change (it feeds only the false-block guard). Unkeyed findings never
 * count as false positives in F0.5.
 */
export function scoreUnit(result, derivedKey) {
  const kind = metricKind(result.skill);
  const found = matchFindings(result.findings, derivedKey);
  const defectTotal = (derivedKey.entries ?? []).filter((e) => e.kind === 'defect').length;
  const tp = found.defects.length;
  const fp = found.decoys.length;
  const fn = Math.max(0, defectTotal - tp);
  const after = result.after ?? null;
  const visibleFailures = Number(after?.visibleFailures ?? 0);
  const oraclesPass = (names) => Boolean(after) && names.length > 0
    && names.every((n) => after.oracles?.[n] === true) && visibleFailures === 0;
  const clean = Boolean(derivedKey.cleanChange);
  const voided = result.audit?.void === true;

  let primary = null;
  if (kind === 'f05') primary = f05(tp, fp, fn);
  else primary = oraclesPass(derivedKey.oracles ?? []) ? 1 : 0;
  if (voided || clean) primary = null;

  const proven = new Set((result.proofs ?? []).filter((p) => p.resolves === true).map((p) => p.index));
  let confirmed = 0;
  let inflated = 0;
  (result.findings ?? []).forEach((f, i) => {
    if (String(f?.tier).toUpperCase() !== 'CONFIRMED') return;
    confirmed += 1;
    if (found.perFinding[i].kind === 'decoy' || !proven.has(i)) inflated += 1;
  });

  return {
    unitId: result.unitId,
    task: result.task,
    skill: result.skill,
    arm: result.arm,
    void: voided,
    clean,
    primary,
    tp,
    fp,
    fn,
    decoyHits: fp,
    unkeyed: found.unkeyed,
    confirmed,
    inflated,
    regressions: visibleFailures,
    falseBlock: clean && result.verdict === 'block',
    capHit: result.capHit === true,
    timedOut: result.timedOut === true,
    costUsd: Number(result.costUsd ?? 0),
    wallMs: Number(result.wallMs ?? 0),
  };
}

// ---- proof resolution -------------------------------------------------------------------

// Ported from scripts/revalidate-register.mjs (receipt grammar :221-241, resolution rule
// :243-270); that CLI is not imported. A proof resolves only to evidence that a run happened or an
// artifact was kept: an RCPT-NNN row in <sandbox>/RUN_RECEIPTS.md (an `exit N` after the id must
// equal the recorded code), a file that exists in the sandbox, or a quoted test name found in a
// sandbox test file. A bare command string never resolves. The bench's own output files and the
// receipts file do not count as evidence files, mirroring the source's exclusion of the register.
const SELF_FILES = new Set(['BENCH_FINDINGS.json', 'BENCH_SUMMARY.json', 'RUN_RECEIPTS.md']);
const RECEIPT_RE = /\b(RCPT-\d+)\b(?:[^\n\w]{0,4}exit(?:\s*code)?\s*[:=]?\s*(-?\d+))?/gi;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** RUN_RECEIPTS.md rows (| RCPT-NNN | time | sha | exit | sha256 | command |) as id -> exit code. */
function loadReceipts(sandboxDir) {
  const file = join(sandboxDir, 'RUN_RECEIPTS.md');
  if (!existsSync(file)) return null;
  const rows = new Map();
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const cells = raw.replace(/\r$/, '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length !== 6 || !/^RCPT-\d+$/.test(cells[0]) || !/^-?\d+$/.test(cells[3])
      || !/^[0-9a-f]{64}$/i.test(cells[4]) || !cells[5]) continue;
    rows.set(cells[0], { exit: Number(cells[3]) });
  }
  return rows;
}

/** A sandbox-relative path that names an existing regular file inside the sandbox. */
function sandboxFile(sandboxDir, p) {
  const abs = resolve(sandboxDir, p);
  if (!abs.startsWith(resolve(sandboxDir) + sep) || SELF_FILES.has(relative(sandboxDir, abs))) return false;
  try {
    return statSync(abs).isFile() && realpathSync(abs).startsWith(realpathSync(sandboxDir) + sep);
  } catch {
    return false;
  }
}

/** Files under dir whose relative path contains "test" or "spec", skipping .git and node_modules. */
function testFiles(dir, root = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) testFiles(p, root, out);
    else if (e.isFile() && /test|spec/i.test(relative(root, p)) && !SELF_FILES.has(e.name)) out.push(p);
  }
  return out;
}

/** Why a proof does not resolve, or null when it does. */
export function proofIssue(proof, sandboxDir) {
  const value = typeof proof === 'string' ? proof : '';
  if (!value.trim()) return 'empty proof';
  const cited = [...value.matchAll(RECEIPT_RE)];
  if (cited.length) {
    const rows = loadReceipts(sandboxDir);
    if (!rows) return 'cites a receipt but no RUN_RECEIPTS.md was found';
    for (const m of cited) {
      const row = rows.get(m[1].toUpperCase());
      if (!row) return `receipt ${m[1]} is not in RUN_RECEIPTS.md`;
      if (m[2] !== undefined && Number(m[2]) !== row.exit) return `receipt ${m[1]} recorded exit ${row.exit}, proof claims exit ${m[2]}`;
    }
    return null;
  }
  const spans = /`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(?<![\w./-])([\w./-]+\.\w+)(?![\w/-])/g;
  for (const m of value.matchAll(spans)) {
    const tok = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim().replace(/:\d+$/, '');
    if (tok && sandboxFile(sandboxDir, tok)) return null;
  }
  const tests = testFiles(sandboxDir);
  for (const m of value.matchAll(/`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'/g)) {
    const tok = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!tok) continue;
    for (const f of tests) {
      try {
        if (statSync(f).size < 524288 && readFileSync(f, 'utf8').includes(tok)) return null;
      } catch { /* unreadable */ }
    }
  }
  return 'no receipt, sandbox file, or test name';
}

/** True when the proof resolves in the sandbox. */
export function resolveProof(proof, sandboxDir) {
  return proofIssue(proof, sandboxDir) === null;
}

// ---- bootstrap --------------------------------------------------------------------------

/** mulberry32: a small deterministic PRNG returning floats in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stratified bootstrap of the skill effect. `perTask` is [{ skill: number[], control: number[] }],
 * one stratum per task and arm. The effect is the mean over tasks of (skill mean - control mean);
 * a task missing either arm is dropped. Returns the point effect and a 90% percentile interval,
 * or nulls when no task has both arms. The same inputs give the same output.
 */
export function bootstrap(perTask, { iterations = 10000, seed = 1 } = {}) {
  const tasks = perTask.filter((t) => t.skill.length && t.control.length);
  if (!tasks.length) return { effect: null, lo: null, hi: null };
  const effect = mean(tasks.map((t) => mean(t.skill) - mean(t.control)));
  const rand = mulberry32(seed);
  const resampleMean = (xs) => {
    let s = 0;
    for (let i = 0; i < xs.length; i += 1) s += xs[Math.floor(rand() * xs.length)];
    return s / xs.length;
  };
  const draws = [];
  for (let i = 0; i < iterations; i += 1) {
    draws.push(mean(tasks.map((t) => resampleMean(t.skill) - resampleMean(t.control))));
  }
  draws.sort((a, b) => a - b);
  const n = draws.length;
  return {
    effect,
    lo: draws[Math.floor(0.05 * n)],
    hi: draws[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
  };
}

// ---- skill summary ----------------------------------------------------------------------

const ratio = (s, c) => (c > 0 ? s / c : s > 0 ? Infinity : 1);

/** Build one guard entry: skill value, control value, limit, and whether the bound holds. */
function guard(applies, skill, control, limit, margin = 0) {
  return { applies, skill, control, limit, margin, holds: !applies || skill <= limit + EPS };
}

/**
 * Summarize one skill: effect and interval, guards, cost and wall ratios, cap hits and timeouts
 * per arm, and the void share. `units` are raw per-unit results (other skills are ignored),
 * `keys` maps task id to its derived key, `srcLines` is the target's physical line count under
 * src/. Void units are excluded from every metric and counted toward the void share.
 * `adjudicatedTrueShare` is the optional adjudication result: when at least 0.5, the unkeyed guard
 * holds on that evidence.
 */
export function summarizeSkill({ skill, matrixSkill, units, keys, srcLines, iterations, seed, adjudicatedTrueShare = null }) {
  const scored = units.filter((u) => u.skill === skill).map((u) => {
    if (!keys[u.task]) throw new Error(`no derived key for task ${u.task}`);
    return scoreUnit(u, keys[u.task]);
  });
  const live = scored.filter((s) => !s.void);
  const arm = (name, rows = live) => rows.filter((s) => s.arm === name);
  const detection = DETECTION.has(skill);

  const taskIds = [...new Set(live.filter((s) => s.primary !== null).map((s) => s.task))];
  const perTask = taskIds.map((task) => ({
    task,
    skill: live.filter((s) => s.task === task && s.arm === 'skill' && s.primary !== null).map((s) => s.primary),
    control: live.filter((s) => s.task === task && s.arm === 'control' && s.primary !== null).map((s) => s.primary),
  }));
  const interval = bootstrap(perTask, { iterations, seed });

  const voids = { skill: arm('skill', scored).filter((s) => s.void).length, control: arm('control', scored).filter((s) => s.void).length };
  const voidShare = scored.length ? (voids.skill + voids.control) / scored.length : 0;
  const withControl = perTask.filter((t) => t.control.length);
  const saturated = withControl.length > 0 && withControl.every((t) => mean(t.control) >= BOUNDS.saturation - EPS);

  // The clean change feeds only the false-block guard.
  const body = (name) => arm(name).filter((s) => !s.clean);
  const stat = (name) => {
    const rows = body(name);
    const confirmed = sum(rows.map((s) => s.confirmed));
    const clean = arm(name).filter((s) => s.clean);
    return {
      inflation: confirmed ? sum(rows.map((s) => s.inflated)) / confirmed : 0,
      decoy: mean(rows.map((s) => s.decoyHits)),
      regressions: mean(rows.map((s) => s.regressions)),
      falseBlocks: clean.length ? clean.filter((s) => s.falseBlock).length / clean.length : 0,
      unkeyed: srcLines > 0 ? (mean(rows.map((s) => s.unkeyed)) * 1000) / srcLines : 0,
    };
  };
  const sk = stat('skill');
  const ct = stat('control');
  const adjudicated = adjudicatedTrueShare !== null && adjudicatedTrueShare >= 0.5;
  const unkeyed = guard(detection, sk.unkeyed, ct.unkeyed, ct.unkeyed * BOUNDS.unkeyedRatio);
  if (adjudicated) unkeyed.holds = true;
  const guards = {
    inflation: guard(true, sk.inflation, ct.inflation, ct.inflation + BOUNDS.inflation, BOUNDS.inflation),
    decoy: guard(detection, sk.decoy, ct.decoy, ct.decoy + BOUNDS.decoy, BOUNDS.decoy),
    regressions: guard(REGRESSION_SKILLS.has(skill), sk.regressions, ct.regressions, ct.regressions),
    falseBlocks: guard(skill === 'rigor:deep-review', sk.falseBlocks, ct.falseBlocks, ct.falseBlocks),
    unkeyed,
  };

  const side = (name) => arm(name);
  const totals = (name) => ({
    cost: mean(side(name).map((s) => s.costUsd)),
    wall: mean(side(name).map((s) => s.wallMs)),
    capHits: side(name).filter((s) => s.capHit).length,
    timeouts: side(name).filter((s) => s.timedOut).length,
    units: side(name).length,
  });
  const a = totals('skill');
  const b = totals('control');
  return {
    skill,
    metric: matrixSkill.metric,
    minDelta: matrixSkill.minDelta,
    effect: interval.effect,
    lo: interval.lo,
    hi: interval.hi,
    units: { skill: a.units, control: b.units },
    voids: { ...voids, share: voidShare },
    instrument: { saturated, voidShare, tripped: saturated || voidShare > BOUNDS.voidShare + EPS },
    guards,
    adjudicated,
    cost: { skill: a.cost, control: b.cost },
    wall: { skill: a.wall, control: b.wall },
    costRatio: ratio(a.cost, b.cost),
    wallRatio: ratio(a.wall, b.wall),
    capHits: { skill: a.capHits, control: b.capHits },
    timeouts: { skill: a.timeouts, control: b.timeouts },
  };
}

// ---- verdict ----------------------------------------------------------------------------

/** Apply the six ordered branches of the verdict rule to a skill summary. */
export function verdict(summary) {
  const { effect, lo, hi, minDelta, instrument, guards } = summary;
  if (instrument.tripped) {
    const why = [];
    if (instrument.saturated) why.push('the control arm scores at least 0.9 on every task');
    if (instrument.voidShare > BOUNDS.voidShare + EPS) why.push(`void share ${instrument.voidShare.toFixed(2)} exceeds 0.25`);
    return { verdict: VERDICTS.instrument, reasons: [...why, 'the fixture must change'] };
  }
  if (effect === null || effect === undefined) {
    return { verdict: VERDICTS.power, reasons: ['no task has scored units in both arms'] };
  }
  const clears = effect >= minDelta - EPS && lo > 0;
  const failed = GUARDS.filter((g) => guards[g].applies && !guards[g].holds);
  const costOk = summary.costRatio <= BOUNDS.costRatio + EPS && summary.wallRatio <= BOUNDS.wallRatio + EPS;
  if (clears) {
    if (!failed.length && costOk) {
      return { verdict: VERDICTS.keep, reasons: ['effect clears the minimum delta, the lower bound is above 0, all guards hold, cost and wall ratios are within 4.0'] };
    }
    const reasons = failed.map((g) => `guard ${g} breached`);
    if (summary.costRatio > BOUNDS.costRatio + EPS) reasons.push(`cost ratio ${fmtRatio(summary.costRatio)} exceeds 4.0`);
    if (summary.wallRatio > BOUNDS.wallRatio + EPS) reasons.push(`wall ratio ${fmtRatio(summary.wallRatio)} exceeds 4.0`);
    return { verdict: VERDICTS.fixGuard, reasons };
  }
  const includesZero = lo <= 0 && hi >= 0;
  const beats = ['inflation', 'decoy']
    .filter((g) => guards[g].applies && guards[g].control - guards[g].skill >= 2 * guards[g].margin - EPS);
  if (includesZero && beats.length) {
    return { verdict: VERDICTS.fixValue, reasons: [`the interval includes 0 and the skill beats control on ${beats.join(' and ')} by at least twice the bound`] };
  }
  if (hi < minDelta - EPS) {
    return { verdict: VERDICTS.retire, reasons: ['the interval upper bound is below the minimum delta'] };
  }
  return { verdict: VERDICTS.power, reasons: ['no other branch applies; a larger n needs a new pre-registered snapshot'] };
}

// ---- report -----------------------------------------------------------------------------

function fmtRatio(x) {
  return Number.isFinite(x) ? x.toFixed(2) : 'inf';
}
const fmt = (x, d = 3) => (x === null || x === undefined ? 'n/a' : Number.isFinite(x) ? x.toFixed(d) : 'inf');

/** Render a plan field for the pre-registration block: scalars and arrays of scalars only. */
function planValue(v) {
  if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== 'object') ? v.join(', ') : null;
  return v === null || typeof v !== 'object' ? String(v) : null;
}

/** Markdown report: the pre-registration block, then one row per skill, then the verdict reasons. */
export function renderReport({ plan, summaries }) {
  const out = ['# Beat the bare model: report', '', '## Pre-registration', ''];
  for (const [k, v] of Object.entries(plan ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const text = planValue(v);
    if (text !== null) out.push(`- ${k}: ${text}`);
  }
  out.push(
    '- verdict rule: instrument, KEEP, FIX (cost or guard), FIX (guard value), RETIRE candidate, INCONCLUSIVE (power), in that order',
    `- bounds: inflation +${BOUNDS.inflation}, decoy hits +${BOUNDS.decoy}, regressions and false blocks at most control, unkeyed ${BOUNDS.unkeyedRatio}x control, cost and wall ratio at most ${BOUNDS.costRatio}`,
    '- interval: 90% stratified bootstrap by task and arm',
    '',
    '## Results',
    '',
    '| Skill | Effect | 90% interval | Min delta | Inflation (s/c) | Decoy hits (s/c) | Regressions (s/c) | False blocks (s/c) | Unkeyed per 1k (s/c) | Cost ratio | Wall ratio | Cap hits (s/c) | Timeouts (s/c) | Voids (s/c) | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  const verdicts = summaries.map((s) => ({ s, v: verdict(s) }));
  const pair = (g) => (g.applies ? `${fmt(g.skill, 2)}/${fmt(g.control, 2)}${g.holds ? '' : ' BREACH'}` : 'n/a');
  for (const { s, v } of verdicts) {
    const g = s.guards;
    out.push(`| ${s.skill} | ${fmt(s.effect)} | [${fmt(s.lo)}, ${fmt(s.hi)}] | ${s.minDelta} | ${pair(g.inflation)} | ${pair(g.decoy)} | ${pair(g.regressions)} | ${pair(g.falseBlocks)} | ${pair(g.unkeyed)} | ${fmtRatio(s.costRatio)} | ${fmtRatio(s.wallRatio)} | ${s.capHits.skill}/${s.capHits.control} | ${s.timeouts.skill}/${s.timeouts.control} | ${s.voids.skill}/${s.voids.control} (${fmt(s.voids.share, 2)}) | ${v.verdict} |`);
  }
  out.push('', '## Reasons', '');
  for (const { s, v } of verdicts) out.push(`- ${s.skill}: ${v.verdict}. ${v.reasons.join('; ')}.`);
  out.push('', 'Cap hits are scored as they stand and are a declared confound. Every verdict is a recommendation; the operator owns retirement.', '');
  return out.join('\n');
}
