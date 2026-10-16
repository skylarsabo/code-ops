// Cases for the runner safeguards in evals/bench/lib/runner.mjs and the spend section of
// evals/bench/lib/report-run.mjs: deny rules, in-flight recovery, attempt accounting. No claude process.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function cases(check) {
  const temps = [];
  const fresh = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); temps.push(d); return d; };
  const mutantPair = (name, real, mutant, detail = '') => {
    check(name, real, detail);
    check(`${name} (mutant fails)`, !mutant, detail);
  };
  try {
    await runnerCases(check, mutantPair, fresh);
  } finally {
    for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Runner safeguards: deny rules, in-flight recovery, attempt accounting, and the report spend section. No claude process. */
async function runnerCases(check, mutantPair, fresh) {
  // Loaded on demand: lib/runner.mjs imports bench.mjs, as bench.mjs's own header explains.
  const { claudeArgs, DENIED_TOOLS, runUnit, recoverInflight, unitEnv, maskSecret, proofResults, assertRunDirIgnored, REPO_ROOT } = await import('../lib/runner.mjs');
  const { positiveFlag } = await import('../bench.mjs');
  const { spendSummary, reportRun } = await import('../lib/report-run.mjs');
  const plan = { bound: { model: 'm' }, capUsd: 5, permissionMode: 'bypassPermissions', isolation: 'bare' };
  const denied = (args) => args.slice(args.indexOf('--disallowedTools') + 1).filter((a) => !a.startsWith('--'));
  const need = ['Bash(taskkill:*)', 'Bash(pkill:*)', 'Bash(killall:*)', 'Bash(Stop-Process:*)', 'Bash(*taskkill*)', 'Bash(*Stop-Process*)'];
  const skillArgs = claudeArgs({ plan, aux: 'aux', pluginCopy: 'aux/plugin' });
  const controlArgs = claudeArgs({ plan, aux: 'aux', pluginCopy: null });
  mutantPair('runner args: both arms deny host-wide process kills',
    [skillArgs, controlArgs].every((a) => need.every((r) => denied(a).includes(r)) && denied(a).includes('WebFetch')),
    [skillArgs, controlArgs].every((a) => need.every((r) => ['WebFetch', 'WebSearch'].includes(r))));
  mutantPair('runner args: arms differ only in --plugin-dir',
    JSON.stringify(skillArgs.slice(0, controlArgs.length)) === JSON.stringify(controlArgs) && skillArgs.slice(controlArgs.length).join() === '--plugin-dir,aux/plugin' && DENIED_TOOLS.length > 2,
    JSON.stringify(skillArgs) === JSON.stringify(controlArgs));

  // In-flight marker recovery
  const runDir = fresh('bench-run-');
  mkdirSync(join(runDir, 'inflight'));
  mkdirSync(join(runDir, 'transcripts'));
  // A process id that was real and has exited, so the marker's runner is provably gone.
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  const marker = (id, attempt, startedAt) => writeFileSync(join(runDir, 'inflight', `${id}.json`), JSON.stringify({ unitId: id, attempt, startedAt, runnerPid: deadPid }));
  marker('a.skill.r1', 1, '2000-01-01T00:00:00.000Z');
  marker('b.skill.r1', 2, '2000-01-01T00:00:00.000Z');
  marker('c.skill.r1', 1, '2999-01-01T00:00:00.000Z');
  writeFileSync(join(runDir, 'transcripts', 'a.skill.r1.a1.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 1.25 })}\n`);
  writeFileSync(join(runDir, 'transcripts', 'c.skill.r1.a1.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 9 })}\n`);
  const ledgerOf = () => readFileSync(join(runDir, 'spend.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // The attempt-1 file of b holds a result, but b was killed on attempt 2: its own file does not exist.
  writeFileSync(join(runDir, 'transcripts', 'b.skill.r1.a1.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 7 })}
`);
  writeFileSync(join(runDir, 'inflight', 'd.skill.r1.json'), JSON.stringify({ unitId: 'd.skill.r1', attempt: 1, startedAt: '2000-01-01T00:00:00.000Z', runnerPid: process.pid }));
  const heldLog = [];
  const recovered = recoverInflight(runDir, (l) => heldLog.push(l));
  const killed = recovered.killed;
  const byId = Object.fromEntries(killed.map((k) => [k.unitId, k]));
  check('inflight recovery: every dead-runner marker becomes a killed ledger line', killed.length === 3 && ledgerOf().length === 3 && ledgerOf().every((e) => e.status === 'killed-unrecorded'));
  mutantPair('inflight recovery: a marker held by a live runner is skipped, logged, and kept',
    recovered.live.join() === 'd.skill.r1' && !killed.some((k) => k.unitId === 'd.skill.r1') && existsSync(join(runDir, 'inflight', 'd.skill.r1.json')) && heldLog.some((l) => /live runner/.test(l)),
    killed.some((k) => k.unitId === 'd.skill.r1'));
  check('inflight recovery: cost comes from the killed attempt own transcript newer than the marker, else null',
    byId['a.skill.r1'].costUsd === 1.25 && byId['b.skill.r1'].costUsd === null /* attempt 1's file never counts for attempt 2 */ && byId['c.skill.r1'].costUsd === null);
  check('inflight recovery: markers are removed and a second pass finds none', readdirSync(join(runDir, 'inflight')).join() === 'd.skill.r1.json' && recoverInflight(runDir, () => {}).killed.length === 0);
  rmSync(join(runDir, 'inflight', 'd.skill.r1.json'));

  // attempts and spentUsd across a void rerun, with a fake runOnce
  const rec = (costUsd, isVoid, apiError = null) => ({ costUsd, wallMs: 10, capHit: false, timedOut: false, exitCode: 0, apiError, audit: { void: isVoid, triggers: isVoid ? [{ rule: 'repo-path' }] : [] }, voidReruns: 0 });
  const script = (...recs) => { const q = [...recs]; return async () => q.shift(); };
  const ctx = (id) => ({ unit: { id }, runDir });
  const voided = await runUnit(ctx('u1'), { run: script(rec(2, true), rec(3, false)), log: () => {} });
  check('runUnit: void rerun keeps both attempts, costUsd is the scored one, spentUsd the sum',
    voided.record.attempts.length === 2 && voided.record.attempts[0].void === true && voided.record.attempts[0].costUsd === 2 && voided.record.attempts[0].triggers[0] === 'repo-path'
    && voided.record.costUsd === 3 && voided.record.spentUsd === 5 && voided.record.voidReruns === 1);
  const clean = await runUnit(ctx('u2'), { run: script(rec(4, false)), log: () => {} });
  check('runUnit: a clean unit has one attempt and spentUsd equal to costUsd', clean.record.attempts.length === 1 && clean.record.spentUsd === 4 && clean.record.costUsd === 4);
  const apiErr = await runUnit(ctx('u3'), { run: script(rec(0.5, false, 'billing')), log: () => {} });
  const after = ledgerOf();
  check('runUnit: an API-error attempt writes no record but lands in the ledger',
    apiErr.apiError === 'billing' && apiErr.record === undefined && after.some((e) => e.unitId === 'u3' && e.status === 'api-error' && e.costUsd === 0.5));
  check('runUnit: every attempt has a ledger line and no marker is left',
    after.filter((e) => e.unitId === 'u1').length === 2 && after.filter((e) => e.status === 'ok').length === 3 && readdirSync(join(runDir, 'inflight')).length === 0);

  // report spend section, with a legacy record that has no attempts
  const sp = spendSummary([{ ...voided.record, unitId: 'u1' }, { unitId: 'old', costUsd: 1.5 }], after.filter((e) => e.status !== 'killed-unrecorded'));
  check('spendSummary: totals cover attempts, void spend, ledger-only attempts, and the legacy record',
    sp.totalUsd === 5 + 4 + 0.5 + 1.5 && sp.voidUsd === 2 && sp.unrecorded === 0 && sp.scoredUsd === 3 + 1.5, JSON.stringify(sp));
  check('spendSummary: killed attempts without a cost are counted, with a cost they add to the total',
    spendSummary([], [{ status: 'killed-unrecorded', costUsd: null }, { status: 'killed-unrecorded', costUsd: 2 }]).unrecorded === 1
    && spendSummary([], [{ status: 'killed-unrecorded', costUsd: 2 }]).totalUsd === 2);
  const orphan = spendSummary([], [{ unitId: 'u9', status: 'ok', costUsd: 1, void: true }, { unitId: 'u9', status: 'api-error', costUsd: 0.25, void: false }]);
  check('spendSummary: a void attempt whose rerun hit an API error still counts, with no unit record',
    orphan.totalUsd === 1.25 && orphan.voidUsd === 1, JSON.stringify(orphan));
  const rd = fresh('bench-rep-');
  mkdirSync(join(rd, 'units'));
  writeFileSync(join(rd, 'plan.json'), JSON.stringify({ bound: { model: 'm', host: 'h', head: 'x' }, units: [] }));
  writeFileSync(join(rd, 'scores.json'), JSON.stringify({ iterations: 1, seed: 1, unitsPlanned: 0, unitsScored: 2, missing: [], summaries: [] }));
  writeFileSync(join(rd, 'units', 'u1.json'), JSON.stringify({ ...voided.record, unitId: 'u1' }));
  writeFileSync(join(rd, 'units', 'old.json'), JSON.stringify({ unitId: 'old', costUsd: 1.5 }));
  writeFileSync(join(rd, 'spend.jsonl'), `${JSON.stringify({ unitId: 'k', status: 'killed-unrecorded', costUsd: null })}\n`);
  let report;
  try { report = readFileSync(reportRun({ runDir: rd }), 'utf8'); } catch (err) { report = String(err); }
  check('REPORT.md: spend section lists total, void, killed, and scored spend',
    /## Spend/.test(report) && /all attempts: \$6\.50/.test(report) && /Void attempts: \$2\.00/.test(report) && /unrecorded spend \(killed or no result\): 1/.test(report) && /Scored units: \$4\.50/.test(report), report.slice(-300));

  // no-result attempts, thrown attempts, attempt numbering, and per-attempt files
  const noRes = (timedOut) => ({ ...rec(null, false), noResult: true, timedOut, exitCode: timedOut ? null : 1 });
  const stopped = await runUnit(ctx('n1'), { run: script(noRes(false)), log: () => {} });
  const nrLine = ledgerOf().find((e) => e.unitId === 'n1');
  mutantPair('runUnit: an attempt with no result line stops the run, writes no record, and logs a null-cost no-result line',
    stopped.noResult === 'exit 1' && stopped.record === undefined && nrLine?.status === 'no-result' && nrLine.costUsd === null,
    stopped.record !== undefined);
  const timed = await runUnit(ctx('n2'), { run: script(noRes(true)), log: () => {} });
  check('runUnit: a timed-out attempt with no result is kept with a null cost',
    timed.record?.costUsd === null && timed.record.spentUsd === 0 && ledgerOf().find((e) => e.unitId === 'n2')?.status === 'no-result');
  const unrecordedSp = spendSummary([], ledgerOf().filter((e) => e.unitId === 'n1' || e.unitId === 'n2'));
  check('spendSummary: no-result attempts count as unrecorded spend', unrecordedSp.unrecorded === 2 && unrecordedSp.totalUsd === 0, JSON.stringify(unrecordedSp));

  const seen = [];
  const numbered = await runUnit({ ...ctx('n3'), firstAttempt: 3 }, { run: async (c) => { seen.push(c.attempt); return seen.length === 1 ? rec(1, true) : rec(1, false); }, log: () => {} });
  check('runUnit: a resumed unit continues attempt numbering and passes the number to the run',
    seen.join() === '3,4' && ledgerOf().filter((e) => e.unitId === 'n3').map((e) => e.attempt).join() === '3,4' && numbered.record.attempts.length === 2);

  let thrown = null;
  const boom = async (c) => {
    mkdirSync(join(runDir, 'transcripts'), { recursive: true });
    writeFileSync(join(runDir, 'transcripts', `${c.unit.id}.a${c.attempt}.jsonl`), `${JSON.stringify({ type: 'result', total_cost_usd: 0.75 })}\n`);
    throw new Error('disk full');
  };
  try { await runUnit(ctx('n4'), { run: boom, log: () => {} }); } catch (err) { thrown = err; }
  const errLine = ledgerOf().find((e) => e.unitId === 'n4');
  mutantPair('runUnit: a throwing attempt rethrows, leaves no marker, and writes an error ledger line with the transcript cost',
    thrown?.message === 'disk full' && !existsSync(join(runDir, 'inflight', 'n4.json')) && errLine?.status === 'error' && errLine.costUsd === 0.75,
    thrown === null);
  try { await runUnit(ctx('n5'), { run: async () => { throw new Error('x'); }, log: () => {} }); } catch { /* expected */ }
  check('runUnit: a throwing attempt with no transcript records a null cost', ledgerOf().find((e) => e.unitId === 'n5')?.costUsd === null);

  // DR1 seam: the tier compare is case-insensitive, and only CONFIRMED findings get a proof entry
  const proofDir = fresh('bench-proof-');
  const pr = proofResults([{ tier: 'confirmed', proof: 'nowhere.js:1' }, { tier: 'LIKELY' }, null, { tier: 'CONFIRMED', proof: 'nowhere.js:2' }], proofDir);
  mutantPair('proofResults: CONFIRMED is matched case-insensitively, one entry per confirmed finding, keyed by index',
    pr.length === 2 && pr[0].index === 0 && pr[1].index === 3 && proofResults(null, proofDir).length === 0,
    pr.length === 1);

  // OS1: allowlisted env, scratch home, masked key
  const home = fresh('bench-home-');
  const env = unitEnv('cfg', home, { GH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k', AWS_SECRET_ACCESS_KEY: 's', Path: 'p', SystemRoot: 'r', USERPROFILE: 'real', HOME: 'real', CLAUDE_CODE_GIT_BASH_PATH: 'g', 'ProgramFiles(x86)': 'pf' });
  mutantPair('unitEnv: credentials are dropped and the allowlisted host variables pass through',
    !('GH_TOKEN' in env) && !('ANTHROPIC_API_KEY' in env) && !('AWS_SECRET_ACCESS_KEY' in env) && env.Path === 'p' && env.SystemRoot === 'r' && env.CLAUDE_CODE_GIT_BASH_PATH === 'g' && env['ProgramFiles(x86)'] === 'pf',
    'GH_TOKEN' in env);
  check('unitEnv: HOME, USERPROFILE, APPDATA, LOCALAPPDATA point at scratch dirs and CLAUDE_CONFIG_DIR is set',
    env.HOME === home && env.USERPROFILE === home && env.APPDATA.startsWith(home) && env.LOCALAPPDATA.startsWith(home) && existsSync(env.APPDATA) && existsSync(env.LOCALAPPDATA) && env.CLAUDE_CONFIG_DIR === 'cfg');
  mutantPair('maskSecret: every exact occurrence is replaced and an empty secret changes nothing',
    maskSecret('a sk-1 b sk-1', 'sk-1') === 'a <REDACTED:api-key> b <REDACTED:api-key>' && maskSecret('abc', '') === 'abc',
    maskSecret('a sk-1', 'sk-1').includes('sk-1'));

  // OS2: a run folder inside the repo must be git-ignored
  const ignoredOk = (() => { try { assertRunDirIgnored(join(REPO_ROOT, 'code-ops-docs', '80 Runs', 'x-case')); return true; } catch { return false; } })();
  const trackedRefused = (() => { try { assertRunDirIgnored(join(REPO_ROOT, 'evals', 'bench', 'x-case')); return false; } catch (err) { return /not git-ignored/.test(err.message); } })();
  const outsideOk = (() => { try { assertRunDirIgnored(fresh('bench-out-')); return true; } catch { return false; } })();
  mutantPair('assertRunDirIgnored: an ignored folder and a folder outside the repo pass, a tracked-tree folder is refused',
    ignoredOk && trackedRefused && outsideOk, !trackedRefused);

  // DR3: flag parsing
  const flagErr = (v) => { try { positiveFlag('reps', v, 4); return null; } catch (err) { return err.message; } };
  mutantPair('positiveFlag: NaN, zero, negative, and non-finite values are refused with the flag name; absent takes the default',
    ['abc', '0', '-1', 'Infinity', ''].every((v) => /^--reps must be/.test(flagErr(v) ?? '')) && positiveFlag('reps', undefined, 4) === 4 && positiveFlag('reps', '2.5', 4) === 2.5,
    flagErr('abc') === null);
}
