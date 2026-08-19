#!/usr/bin/env node
// Regression eval for scripts/estimate-run-cost.mjs — pins the PRE-run estimator's three
// honesty contracts:
//
//   a-c. Three comparable prior runs produce a real estimate: a min/median/max dispatch range
//        read from their DISPATCH_LEDGER.md files, a model-class mix resolved through
//        scripts/model-tiers.mjs, and NO caveat block.
//   d-e. One comparable prior run produces the same shape PLUS the loud n<3 caveat. The failure
//        this pins is a lead reading a median off a single observation as a plan.
//   f-g. An empty runs dir and an absent one both print "no prior runs, no estimate" and exit 0.
//        An estimator that failed a run for having no history would make adopting it a risk.
//   h-j. A --skill filter that matches nothing falls back to every run and SAYS so; a run whose
//        ledger half-parses is reported with its unparseable rows; --repo-size is recorded and
//        explicitly not applied, because a ledger records no repo size to regress against.
//   k-l. No token-price math appears anywhere in the output, and a usage error exits 2 while
//        every readable request exits 0.
//   n-p. A run folder whose ledger has no dispatch rows — what `dispatch-ledger.mjs phase`
//        leaves behind when a run opens a phase and dies — is EXCLUDED from the range and
//        named, never counted as a run that cost 0; the n<3 guess caveat fires on the count of
//        runs that yielded rows, not on the count of folders; and a ledger below the walk's
//        depth cap is disclosed rather than dropped behind "no ledger found under this tree".
//   q.   Grammar (a) — the ledger row shape — is declared once in scripts/ledger-grammar.mjs
//        and imported by the writer and both readers, never re-declared.
//
// Fixtures are built in a throwaway tmp tree rather than committed, following
// evals/dispatch-ledger/run.mjs: one of the cases IS an empty directory, which git cannot track.
//
//   node evals/estimate-run-cost/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'estimate-run-cost.mjs');

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fails.push(detail ? `${name} — ${String(detail).slice(0, 300)}` : name);
};

const run = (args) => {
  try {
    const outp = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
    return { status: 0, stdout: outp, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const HEADER = '| id | role | brief | expected artifact | status |\n| --- | --- | --- | --- | --- |\n';
// Writes one prior-run folder in the vault's `80 Runs/YYYY-MM-DD slug/` shape.
const seedRun = (root, folder, rows) => {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DISPATCH_LEDGER.md'), HEADER + rows.map((r) => `| ${r} |\n`).join(''));
  return dir;
};

const cleanupDirs = [];
try {
  const work = mkdtempSync(join(tmpdir(), 'coh-estimate-'));
  cleanupDirs.push(work);

  // ---- three comparable runs: 2, 4, and 3 dispatches -> min 2, median 3, max 4 ----
  const runs = join(work, 'runs');
  mkdirSync(runs, { recursive: true });
  seedRun(runs, '2026-08-01 ship auth', [
    'D-001 | explorer@claude-sonnet-5 | map auth | AUTH_MAP.md | reported',
    'D-002 | reviewer@claude-opus-5 | review the diff | REVIEW.md | reported',
  ]);
  seedRun(runs, '2026-08-05 ship cache', [
    'D-001 | explorer@claude-sonnet-5 | map the cache layer | MAP.md | reported',
    'D-002 | mech@claude-haiku-4-5-20251001 | rename the config field | diff | reported',
    'D-003 | reviewer@claude-opus-5 | review the diff | REVIEW.md | reported',
    'D-004 | verifier@claude-opus-5 | run the gate chain | RECEIPTS.md | reported',
  ]);
  seedRun(runs, '2026-08-12 ship parser', [
    'D-001 | explorer@claude-sonnet-5 | map the parser | MAP.md | reported',
    'D-002 | reviewer@claude-opus-5 | review the diff | REVIEW.md | reported',
    'D-003 | mech@claude-sonnet-5 | re-sync the vendored copies | diff | reported',
  ]);
  // A fourth run of a different shape, so the --skill filter has something to exclude.
  seedRun(runs, '2026-08-09 bug-hunt payments', [
    'D-001 | tracer@grok-4.6 | trace the race condition | TRACE.md | reported',
    'D-002 | verifier | run the repro | RECEIPTS.md | reported',
  ]);

  const a = run(['--runs', runs, '--skill', 'ship']);
  check('a. three comparable runs exit 0', a.status === 0, a.stdout + a.stderr);
  check('a. the basis names the skill filter and its count',
    /basis: 3 prior run\(s\) whose folder names carry "ship"/.test(a.stdout), a.stdout);
  check('b. the dispatch-count range is min 2, median 3, max 4',
    /dispatch-count range: min 2, median 3, max 4/.test(a.stdout), a.stdout);
  check('b. every comparable run is listed with its own count',
    /2026-08-01 ship auth: 2 dispatch\(es\)/.test(a.stdout)
    && /2026-08-05 ship cache: 4 dispatch\(es\)/.test(a.stdout)
    && /2026-08-12 ship parser: 3 dispatch\(es\)/.test(a.stdout), a.stdout);
  check('b. the non-matching run is excluded', !/bug-hunt payments/.test(a.stdout), a.stdout);
  check('c. the model-class mix resolves rungs with shares',
    /light: 1 \(11\.1%\)/.test(a.stdout) && /mid: 4 \(44\.4%\)/.test(a.stdout) && /strong: 4 \(44\.4%\)/.test(a.stdout), a.stdout);
  check('c. n>=3 prints NO caveat block', !/CAVEAT/.test(a.stdout), a.stdout);

  // ---- one comparable run: same shape, plus the loud n<3 caveat -----------------
  const d = run(['--runs', runs, '--skill', 'bug-hunt']);
  check('d. one comparable run still exits 0', d.status === 0, d.stdout + d.stderr);
  check('d. the range is drawn from that single run', /dispatch-count range: min 2, median 2, max 2/.test(d.stdout), d.stdout);
  check('e. n<3 prints the guess caveat, naming n', /CAVEAT — THIS IS A GUESS, NOT AN ESTIMATE/.test(d.stdout)
    && /Drawn from 1 comparable run\(s\)/.test(d.stdout), d.stdout);
  check('e. an unstamped row is its own class, never folded onto a rung', /unstamped: 1/.test(d.stdout), d.stdout);
  check('e. an id serving several rungs reads `ambiguous`', /ambiguous: 1/.test(d.stdout), d.stdout);

  // ---- empty and absent runs dirs: no estimate, exit 0 -------------------------
  const emptyDir = join(work, 'empty');
  mkdirSync(emptyDir, { recursive: true });
  const f = run(['--runs', emptyDir]);
  check('f. an empty runs dir exits 0', f.status === 0, f.stdout + f.stderr);
  check('f. an empty runs dir says no prior runs, no estimate',
    /no prior runs, no estimate — no DISPATCH_LEDGER\.md found/.test(f.stdout), f.stdout);
  check('f. an empty runs dir prints no range', !/dispatch-count range/.test(f.stdout), f.stdout);

  const g = run(['--runs', join(work, 'does-not-exist')]);
  check('g. an absent runs dir exits 0 (never fails the run it is advising)', g.status === 0, g.stdout + g.stderr);
  check('g. an absent runs dir says no prior runs, no estimate',
    /no prior runs, no estimate — .*does not exist or is not a directory/.test(g.stdout), g.stdout);

  // ---- a --skill filter matching nothing falls back, and says so ---------------
  const h = run(['--runs', runs, '--skill', 'tor-egress-audit']);
  check('h. an unmatched skill filter exits 0', h.status === 0, h.stdout + h.stderr);
  check('h. the fallback is stated in the basis line',
    /basis: all 4 prior run\(s\) — none carry "tor-egress-audit" in their folder name/.test(h.stdout), h.stdout);
  check('h. and repeated as a caveat', /CAVEAT — no prior run folder names "tor-egress-audit"/.test(h.stdout), h.stdout);

  // ---- a half-parsing ledger is reported, not silently counted low -------------
  const broken = join(work, 'broken');
  mkdirSync(broken, { recursive: true });
  seedRun(broken, '2026-08-14 ship widget', ['D-001 | explorer@claude-sonnet-5 | map it | MAP.md | reported']);
  writeFileSync(join(broken, '2026-08-14 ship widget', 'DISPATCH_LEDGER.md'),
    HEADER
    + '| D-001 | explorer@claude-sonnet-5 | map it | MAP.md | reported |\n'
    + '| D-002 | reviewer | too few columns | reported |\n');
  const i = run(['--runs', broken]);
  check('i. a half-parsing ledger exits 0', i.status === 0, i.stdout + i.stderr);
  check('i. its unparseable rows are named beside its count',
    /2026-08-14 ship widget: 1 dispatch\(es\), 1 unparseable row\(s\)/.test(i.stdout), i.stdout);
  check('i. and raise their own caveat', /CAVEAT — 1 comparable run\(s\) carry unparseable ledger rows/.test(i.stdout), i.stdout);

  // ---- --repo-size is recorded, never applied ---------------------------------
  const j = run(['--runs', runs, '--skill', 'ship', '--repo-size', '40']);
  check('j. --repo-size exits 0', j.status === 0, j.stdout + j.stderr);
  check('j. --repo-size is recorded and explicitly NOT applied',
    /--repo-size 40 MB is recorded and NOT applied/.test(j.stdout), j.stdout);
  check('j. the range is unchanged by it', /dispatch-count range: min 2, median 3, max 4/.test(j.stdout), j.stdout);

  // ---- no token-price math, anywhere ------------------------------------------
  check('k. the output carries no currency or per-token figure', !/[$€£]|per 1M|cost: \d/.test(a.stdout), a.stdout);
  check('k. and says why it counts dispatches instead',
    /It does no token-price math/.test(a.stdout), a.stdout);

  // ---- --json emits the same numbers ------------------------------------------
  const jsonPath = join(work, 'estimate.json');
  const jr = run(['--runs', runs, '--skill', 'ship', '--json', jsonPath]);
  check('l. --json exits 0 and leaves the prose intact', jr.status === 0 && /dispatch-count range/.test(jr.stdout), jr.stdout + jr.stderr);
  let mj = null;
  try { mj = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch (e) { mj = { parseError: String(e.message) }; }
  check('l. --json parses', mj && !mj.parseError, JSON.stringify(mj));
  check('l. the machine shape carries the same range',
    mj?.estimate?.min === 2 && mj?.estimate?.median === 3 && mj?.estimate?.max === 4, JSON.stringify(mj?.estimate));
  check('l. and the same class mix and counts',
    mj?.comparableRuns === 3 && mj?.priorRuns === 4 && mj?.modelClassMix?.strong === 4, JSON.stringify(mj));
  check('l. a clean n>=3 estimate carries no caveats', Array.isArray(mj?.caveats) && mj.caveats.length === 0, JSON.stringify(mj?.caveats));

  // ---- a zero-row ledger is excluded from the basis, not counted as a 0-cost run ----
  // The fixture is exactly what `dispatch-ledger.mjs phase` writes for a run that opened a
  // phase and died before its first dispatch: header, rule, phase marker, no rows.
  const aborted = join(work, 'aborted-tree');
  mkdirSync(aborted, { recursive: true });
  seedRun(aborted, '2026-08-01 ship auth', [
    'D-001 | explorer@claude-sonnet-5 | map auth | AUTH_MAP.md | reported',
    'D-002 | reviewer@claude-opus-5 | review the diff | REVIEW.md | reported',
  ]);
  seedRun(aborted, '2026-08-05 ship cache', [
    'D-001 | explorer@claude-sonnet-5 | map the cache layer | MAP.md | reported',
    'D-002 | mech@claude-haiku-4-5-20251001 | rename the config field | diff | reported',
    'D-003 | reviewer@claude-opus-5 | review the diff | REVIEW.md | reported',
    'D-004 | verifier@claude-opus-5 | run the gate chain | RECEIPTS.md | reported',
  ]);
  mkdirSync(join(aborted, '2026-08-07 ship aborted'), { recursive: true });
  writeFileSync(join(aborted, '2026-08-07 ship aborted', 'DISPATCH_LEDGER.md'),
    HEADER + '> phase: recon · lead@claude-opus-5\n');

  const abortedJson = join(work, 'aborted.json');
  const n = run(['--runs', aborted, '--json', abortedJson]);
  check('n. a tree carrying an aborted run exits 0', n.status === 0, n.stdout + n.stderr);
  check('n. the zero-row ledger does not pull the range to min 0',
    /dispatch-count range: min 2, median 3, max 4/.test(n.stdout), n.stdout);
  check('n. the zero-row run is not listed as a 0-dispatch comparable run',
    !/2026-08-07 ship aborted: 0 dispatch\(es\)/.test(n.stdout), n.stdout);
  check('n. it is named in its own caveat instead',
    /CAVEAT — 1 run folder\(s\) carry a ledger with no dispatch rows/.test(n.stdout)
    && /2026-08-07 ship aborted/.test(n.stdout), n.stdout);
  check('o. the n<3 guess caveat fires on the honest count of 2, not the 3 folders',
    /CAVEAT — THIS IS A GUESS, NOT AN ESTIMATE/.test(n.stdout)
    && /Drawn from 2 comparable run\(s\)/.test(n.stdout), n.stdout);
  let nj = null;
  try { nj = JSON.parse(readFileSync(abortedJson, 'utf8')); } catch (e) { nj = { parseError: String(e.message) }; }
  check('o. the machine shape separates usable runs from run folders',
    nj?.usableRuns === 2 && nj?.emptyLedgerRuns === 1 && nj?.comparableRuns === 3, JSON.stringify(nj));
  check('o. and the estimate rests on the usable ones',
    nj?.estimate?.min === 2 && nj?.estimate?.median === 3, JSON.stringify(nj?.estimate));

  // Every comparable ledger empty: no estimate at all, rather than a range of zeroes.
  const allEmpty = join(work, 'all-empty');
  mkdirSync(join(allEmpty, '2026-08-07 ship aborted'), { recursive: true });
  writeFileSync(join(allEmpty, '2026-08-07 ship aborted', 'DISPATCH_LEDGER.md'),
    HEADER + '> phase: recon · lead@claude-opus-5\n');
  const nn = run(['--runs', allEmpty]);
  check('n. a tree of only zero-row ledgers prints no range', !/dispatch-count range/.test(nn.stdout), nn.stdout);
  check('n. and says why', /every comparable ledger parsed to zero dispatch rows/.test(nn.stdout), nn.stdout);

  // ---- the depth cap is disclosed, never silent -------------------------------
  const deep = join(work, 'deep');
  mkdirSync(join(deep, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
  writeFileSync(join(deep, 'a', 'b', 'c', 'd', 'e', 'DISPATCH_LEDGER.md'),
    HEADER + '| D-001 | explorer@claude-sonnet-5 | map it | MAP.md | reported |\n');
  const pcap = run(['--runs', deep]);
  check('p. a tree whose only ledger sits below the cap exits 0', pcap.status === 0, pcap.stdout + pcap.stderr);
  check('p. the not-found message is qualified by the cap, not stated as absolute',
    /no DISPATCH_LEDGER\.md found within 3 levels of this tree/.test(pcap.stdout)
    && !/found under this tree/.test(pcap.stdout), pcap.stdout);
  check('p. and the unsearched directory is named',
    /CAVEAT — the walk stops at 3 levels below --runs/.test(pcap.stdout), pcap.stdout);
  check('p. an unbounded-enough tree still says "under this tree" with no cap caveat',
    /no DISPATCH_LEDGER\.md found under this tree/.test(f.stdout) && !/the walk stops at/.test(f.stdout), f.stdout);

  // ---- grammar (a) has one source, not three copies ---------------------------
  // The row shape was duplicated across the writer and both readers. Each treats a
  // non-matching row as `malformed`, so a drifted copy would undercount dispatches quietly
  // instead of failing. This pins the structural fix: nobody re-declares the pattern.
  const grammarSrc = readFileSync(join(REPO, 'scripts', 'ledger-grammar.mjs'), 'utf8');
  check('q. the shared grammar exports the row pattern and its status set',
    /export const LEDGER_ROW_RE\b/.test(grammarSrc) && /export const LEDGER_STATUSES\b/.test(grammarSrc), grammarSrc.slice(0, 200));
  check('q. and imports nothing, so the argv-dispatching writer can read from it too',
    !/^\s*import\s/m.test(grammarSrc), grammarSrc.slice(0, 200));
  for (const consumer of ['estimate-run-cost.mjs', 'calibration-metrics.mjs', 'dispatch-ledger.mjs']) {
    const src = readFileSync(join(REPO, 'scripts', consumer), 'utf8');
    check(`q. ${consumer} imports the row grammar instead of re-declaring it`,
      /from '\.\/ledger-grammar\.mjs'/.test(src)
      && !/^const\s+(LEDGER_ROW_RE|ROW_RE)\s*=\s*\//m.test(src)
      && !/^const\s+(LEDGER_STATUSES|STATUSES)\s*=\s*\[/m.test(src), consumer);
  }

  // ---- usage errors fail closed at exit 2 -------------------------------------
  check('m. no --runs exits 2', run([]).status === 2);
  check('m. an unknown flag exits 2', run(['--runs', runs, '--bogus', 'x']).status === 2);
  check('m. a non-numeric --repo-size exits 2', run(['--runs', runs, '--repo-size', 'big']).status === 2);
  check('m. a non-finite --repo-size exits 2 too', run(['--runs', runs, '--repo-size', 'Infinity']).status === 2);
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} estimate-run-cost regression check(s) failed:`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('\nOK — all estimate-run-cost regression checks passed.');
