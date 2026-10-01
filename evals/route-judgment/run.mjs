#!/usr/bin/env node
// Deterministic half of the opt-in judgment-orchestration measure from DESIGN_TIER_ROUTING.md:
// does a lead route each unit to the right rung and effort, and pick the premium rung when the
// work warrants it. The live half is manual: hand a lead the files under repo/ (never the key),
// then score the register it writes with evals/score.mjs.
//
// This script pins what needs no model:
//   1. every key entry equals routeUnit() for its basis, so key and rubric cannot drift;
//   2. the key spreads every rung and effort, covers premium triggers 7a to 7d, and holds
//      overuse traps that look important but warrant a lower rung;
//   3. the material the lead receives names no rung, effort, model, or rule, and the key is
//      neither in it nor cited by it;
//   4. ROUTE_MENU.md is uniform for every unit, so the menu itself leaks nothing;
//   5. score.mjs accepts the key (--check) and ranks a perfect register above a register that
//      puts one premium unit at strong, and a register that picks premium on a trap fails.
//
//   node evals/route-judgment/run.mjs                 run the checks
//   node evals/route-judgment/run.mjs --write-menu    regenerate repo/ROUTE_MENU.md

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, withDetail } from '../harness.mjs';
import { EFFORTS, RUNGS, routeUnit, surfaceOfScope } from '../../scripts/route-unit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const KEY_PATH = join(HERE, 'ANSWER_KEY.json');
const REPO = join(HERE, 'repo');
const MENU_PATH = join(REPO, 'ROUTE_MENU.md');
const SCORE = join(ROOT, 'evals', 'score.mjs');

// ---- the menu: one line per unit, rung, and effort ---------------------------------------
// Light, mid, strong, and premium each offer every effort. Frontier sends no effort, so it has
// the one `adaptive` line. Every unit gets the same 13 lines in the same order.
const MENU_HEADER = ['# Route menu', 'Each line is one way to dispatch the named unit. Cite one line per unit.', ''];
const CHOICES = [...RUNGS.filter((rung) => rung !== 'frontier').flatMap((rung) => EFFORTS.map((effort) => [rung, effort])), ['frontier', 'adaptive']];
const unitId = (index) => `U${String(index + 1).padStart(2, '0')}`;
const choiceText = (id, rung, effort) => `${id} | ${rung} | ${effort}`;
const lineOf = (index, rung, effort) => {
  const slot = CHOICES.findIndex(([r, e]) => r === rung && e === effort);
  return slot < 0 ? -1 : MENU_HEADER.length + 1 + index * CHOICES.length + slot;
};
const menuText = (count) => `${[
  ...MENU_HEADER,
  ...Array.from({ length: count }, (_, index) => CHOICES.map(([rung, effort]) => choiceText(unitId(index), rung, effort))).flat(),
].join('\n')}\n`;

const readText = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const key = JSON.parse(readText(KEY_PATH));
const { planted, decoys } = key;

if (process.argv.includes('--write-menu')) {
  writeFileSync(MENU_PATH, menuText(planted.length));
  console.log(`wrote ${MENU_PATH}`);
  process.exit(0);
}

const { fails, check } = tally(withDetail);

// ---- 1. key equals the rubric -------------------------------------------------------------
check('key holds twelve units numbered U01 to U12', planted.length === 12 && planted.every((unit, index) => unit.id === unitId(index)));
for (const [index, unit] of planted.entries()) {
  const { scope, ...basis } = unit.basis;
  const routed = routeUnit({ ...basis, surface: surfaceOfScope(scope) });
  check(
    `${unit.id} equals routeUnit() for its basis`,
    routed.rung === unit.rung && routed.effort === unit.effort && routed.rule === unit.rule,
    `key ${unit.rung}/${unit.effort}/${unit.rule}, rubric ${routed.rung}/${routed.effort}/${routed.rule}`,
  );
  check(
    `${unit.id} cites its own menu line`,
    unit.file === 'ROUTE_MENU.md' && unit.line === lineOf(index, unit.rung, unit.effort) && unit.anchor === choiceText(unit.id, unit.rung, unit.effort),
    `line ${unit.line}, expected ${lineOf(index, unit.rung, unit.effort)}`,
  );
}

// ---- 2. coverage ---------------------------------------------------------------------------
const premium = planted.filter((unit) => unit.rung === 'premium');
const traps = planted.filter((unit) => unit.trap === true);
check('every rung is expected at least once', RUNGS.every((rung) => planted.some((unit) => unit.rung === rung)));
check('every effort is expected at least once', EFFORTS.every((effort) => planted.some((unit) => unit.effort === effort)));
check('at least four units warrant premium', premium.length >= 4, `found ${premium.length}`);
for (const rule of ['7a', '7b', '7c', '7d']) check(`premium trigger ${rule} has a unit`, premium.some((unit) => unit.rule === rule));
check('at least two overuse traps, each on a lower rung than strong', traps.length >= 2 && traps.every((unit) => ['light', 'mid'].includes(unit.rung)));
check('every trap touches a sensitive surface so it looks important', traps.every((unit) => surfaceOfScope(unit.basis.scope) !== 'none'));
check(
  'decoys are exactly the premium pick on each trap',
  decoys.length === traps.length && traps.every((trap) => {
    const decoy = decoys.find((item) => item.id === `OVER-${trap.id}`);
    return decoy && decoy.file === 'ROUTE_MENU.md' && decoy.anchor === choiceText(trap.id, 'premium', 'high') && decoy.line === lineOf(planted.indexOf(trap), 'premium', 'high');
  }),
);

// ---- 3. the material leaks nothing ---------------------------------------------------------
const LEAK = /\b(?:light|mid|strong|premium|frontier|opus|sonnet|haiku|fable|effort|tier|rung|trigger|rubric|ambiguity|reversible|irreversible|peer|peerexception|adaptive|low|medium|high|xhigh|7[a-d])\b/i;
const files = readdirSync(REPO).sort();
check('the lead receives exactly TASK.md, UNITS.md, and ROUTE_MENU.md', files.join(',') === 'ROUTE_MENU.md,TASK.md,UNITS.md', files.join(','));
const units = readText(join(REPO, 'UNITS.md'));
const task = readText(join(REPO, 'TASK.md'));
// A scope path is data, not prose: `.claude-plugin/` is a real directory name, so paths drop out
// before the word scan.
const withoutPaths = (text) => planted.flatMap((unit) => unit.basis.scope).reduce((rest, path) => rest.replaceAll(path, ''), text);
for (const [name, text] of [['UNITS.md', units], ['TASK.md', task]]) {
  const leak = withoutPaths(text).split('\n').map((line, index) => [LEAK.exec(line), index + 1]).find(([match]) => match);
  check(`${name} holds no rung, effort, model, or trigger word`, !leak, leak ? `line ${leak[1]}: ${leak[0][0]}` : '');
}
for (const name of files) {
  check(`${name} never names the key, the rubric, or the scorer`, !/ANSWER_KEY|route-unit|routeUnit|score\.mjs|judgment-orchestration/.test(readText(join(REPO, name))));
}
const sections = units.split(/^## /m).slice(1);
check('UNITS.md has one section per unit, in order', sections.length === 12 && sections.every((section, index) => section.startsWith(`${unitId(index)} `)));
for (const [index, section] of sections.entries()) {
  const unit = planted[index];
  const missing = unit.basis.scope.filter((path) => !section.includes(path));
  check(`${unit.id} section names every scope path and states how a miss is undone`, missing.length === 0 && /^If wrong:/m.test(section) && /^Paths:/m.test(section), missing.join(', '));
  check(`${unit.id} title matches the key`, section.startsWith(`${unit.id} ${unit.title}\n`));
}
const attemptWords = /second (?:attempt|dispatch)/i;
for (const unit of planted) {
  const section = sections[planted.indexOf(unit)] ?? '';
  check(`${unit.id} states a repeat attempt exactly when the key does`, attemptWords.test(section) === ((unit.basis.attempt ?? 1) >= 2));
}

// ---- 4. the menu is uniform ----------------------------------------------------------------
check('ROUTE_MENU.md equals the generated menu (run --write-menu after a key change)', readText(MENU_PATH) === menuText(planted.length));

// ---- 5. scoring ----------------------------------------------------------------------------
const scoreRun = (...args) => spawnSync(process.execPath, [SCORE, KEY_PATH, ...args], { encoding: 'utf8' });
const parse = (stdout) => ({
  found: Number(/Recall:\s+(\d+)\//.exec(stdout)?.[1] ?? NaN),
  flagged: Number(/False positives:\s+(\d+)\//.exec(stdout)?.[1] ?? NaN),
  verdict: /Verdict:\s+(PASS|FAIL)/.exec(stdout)?.[1] ?? null,
});

const keyCheck = scoreRun('--check');
check('score.mjs --check accepts the key against the menu', keyCheck.status === 0, keyCheck.stdout + keyCheck.stderr);

const dir = mkdtempSync(join(tmpdir(), 'route-judgment-'));
try {
  // A register cites one menu line per unit. The reference follows the key exactly.
  const register = (lines, name) => {
    const path = join(dir, `${name}.md`);
    writeFileSync(path, `${lines.map((line) => `ROUTE_MENU.md:${line} reason`).join('\n')}\n`);
    return parse(scoreRun(path, '--no-exit').stdout);
  };
  const reference = planted.map((unit) => unit.line);
  const perfect = register(reference, 'reference');
  check('the reference register scores every unit with no decoy', perfect.found === 12 && perfect.flagged === 0 && perfect.verdict === 'PASS', JSON.stringify(perfect));

  for (const unit of premium) {
    const index = planted.indexOf(unit);
    const mutant = register(reference.map((line, at) => (at === index ? lineOf(index, 'strong', 'high') : line)), `under-${unit.id}`);
    check(`mutant: ${unit.id} at the strong rung scores below the perfect register`, mutant.found < perfect.found, JSON.stringify(mutant));
  }

  const trap = traps[0];
  const trapIndex = planted.indexOf(trap);
  const overuse = register(reference.map((line, at) => (at === trapIndex ? lineOf(trapIndex, 'premium', 'high') : line)), 'overuse');
  check('mutant: premium on an overuse trap flags a decoy and fails', overuse.flagged === 1 && overuse.verdict === 'FAIL', JSON.stringify(overuse));

  const flat = register(planted.map((_, index) => lineOf(index, 'strong', 'high')), 'flat');
  check('mutant: strong at high for every unit fails the pass threshold', flat.verdict === 'FAIL', JSON.stringify(flat));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL route-judgment: ${fails.length} check(s) failed`);
  for (const fail of fails) console.error(`  x ${fail}`);
  process.exit(1);
}
console.log('\nOK route-judgment: key, material, menu, and scoring hold');
