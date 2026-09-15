#!/usr/bin/env node
// Regression eval for scripts/check-handoff.mjs, the structural floor under the handoff
// skill's write contract (plugins/code-ops-suite/skills/handoff/SKILL.md). Asserts a
// conformant fixture passes and each of four distinct, isolated defects fails closed with
// the expected violation text, never a different check tripping instead.
//
//   node evals/handoff-check/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const checker = join(REPO, 'scripts', 'check-handoff.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };
const run = (args) => spawnSync('node', [checker, ...args], { encoding: 'utf8' });
const outOf = (r) => (r.stdout || '') + (r.stderr || '');

// A conformant Open items bullet, held in one place so every fixture below mutates a single
// piece of it and nothing else, isolating each check from the others.
const goodOpenItem = '- PAR-100 close-out: not started · Owner: agent · Done when: register item closed-with-proof · Pointer: path:line';

const BASE_SECTIONS = {
  authority: '## Authority\n\n- No grants recorded in this fixture. None carries into a resumed session.\n\n',
  openItems: `## Open items\n\n${goodOpenItem}\n\n`,
  carriedContext: '## Carried context\n\n- Nothing carried; this fixture needs no analysis file.\n',
};

// Builds a full, otherwise-conformant HANDOFF.md from the three variable sections above, so a
// test case swaps in exactly one broken section and leaves every other check clean.
function buildHandoff({ authority = BASE_SECTIONS.authority, openItems = BASE_SECTIONS.openItems, carriedContext = BASE_SECTIONS.carriedContext, filler = '' } = {}) {
  return [
    '# HANDOFF: check-handoff eval fixture',
    '',
    'Verified-at: abc1234 (main, clean).',
    '',
    '## Goal and state of play',
    '',
    '- Objective: exercise check-handoff.mjs. History: base..head (no exceptions).',
    '',
    '## Registers and artifacts',
    '',
    '- FINDINGS_REGISTER.md: fixture register, pointed at rather than re-pasted. Verified-at: abc1234.',
    '',
    '## Decisions made',
    '',
    '- Used a synthetic fixture instead of a real handoff, because a real one is private run scratch.',
    '',
    '## Traps and dead ends',
    '',
    '- None encountered in this fixture.',
    '',
    '## In-flight boundaries',
    '',
    '- Nothing in flight. Pointer: scripts/check-handoff.mjs:1 · Anchor: `HANDOFF.md structural checker`',
    '',
    openItems,
    authority,
    carriedContext,
    filler,
  ].join('\n');
}

const work = mkdtempSync(join(tmpdir(), 'coh-handoff-'));
const write = (name, text) => { const p = join(work, name); writeFileSync(p, text); return p; };

// === passing fixture ===
const good = write('good.md', buildHandoff());
const rGood = run([good]);
check('conformant fixture exits 0', rGood.status === 0);
check('conformant fixture reports OK', /^OK —/.test(rGood.stdout));

// === missing Authority ===
const noAuthority = write('no-authority.md', buildHandoff({ authority: '' }));
const rNoAuthority = run([noAuthority]);
check('missing Authority section exits 1', rNoAuthority.status === 1);
check('missing Authority section names the heading', /missing required heading: "## Authority"/.test(outOf(rNoAuthority)));

// === Open items entry without Owner ===
const noOwnerItem = '- PAR-100 close-out: not started · Done when: register item closed-with-proof · Pointer: path:line';
const noOwner = write('no-owner.md', buildHandoff({ openItems: `## Open items\n\n${noOwnerItem}\n\n` }));
const rNoOwner = run([noOwner]);
check('Open items entry without Owner exits 1', rNoOwner.status === 1);
check('missing-Owner violation is reported', /missing "Owner: agent\|operator"/.test(outOf(rNoOwner)));
check('missing-Owner fixture does not also trip the imperative check', !/opens with an imperative verb/.test(outOf(rNoOwner)));

// === a noun-phrase label that shares a word with a verb stays conformant ===
const nounItem = '- Review receipts: pending · Owner: operator · Done when: both receipts land · Pointer: path:line';
const rNoun = run([write('noun-item.md', buildHandoff({ openItems: `## Open items\n\n${nounItem}\n\n` }))]);
check('noun-phrase Open items label ("Review receipts") exits 0', rNoun.status === 0);

// === over the size cap ===
const overCap = write('over-cap.md', buildHandoff({ filler: `\n## Carried context filler\n\n${'x'.repeat(7000)}\n` }));
const rOverCap = run([overCap]);
check('over-cap fixture exits 1', rOverCap.status === 1);
check('over-cap violation names the byte cap', /over the 6144-byte cap/.test(outOf(rOverCap)));

// === imperative-led Open items line ===
const imperativeItem = '- Fix PAR-100 next · Owner: agent · Done when: register item closed-with-proof · Pointer: path:line';
const imperative = write('imperative.md', buildHandoff({ openItems: `## Open items\n\n${imperativeItem}\n\n` }));
const rImperative = run([imperative]);
check('imperative-led Open items line exits 1', rImperative.status === 1);
check('imperative violation is reported', /opens with an imperative verb/.test(outOf(rImperative)));
check('imperative fixture still has Owner and Done when (isolates the one check)', !/missing "Owner|missing "Done when/.test(outOf(rImperative)));

// === usage errors ===
const rNoArgs = run([]);
check('no argument exits 2', rNoArgs.status === 2);
const rMissingFile = run([join(work, 'does-not-exist.md')]);
check('missing file exits 2', rMissingFile.status === 2);

rmSync(work, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\nhandoff-check eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nhandoff-check eval passed');
