#!/usr/bin/env node
// Synthetic-only regression coverage. The literal-bracket case is deliberately defensive.
//
// The eval is split into sections, each a child process with its own temp directory and fixture, so
// the sections run in parallel. This parent pins every section's case count and fails the run on a
// crash, a signal kill, a missing closing marker, or a count that differs from the pin.
//   node evals/record-collections/run.mjs                 all sections, in parallel
//   node evals/record-collections/run.mjs --serial        one section at a time (same as --jobs 1)
//   node evals/record-collections/run.mjs --jobs N        at most N sections at once
//   node evals/record-collections/run.mjs --section NAME  one section in this process tree
import { MARKER, runSections } from './parallel.mjs';

// Rewrites runs 3 more cases off win32. weight is the measured seconds of one section, only so the pool
// starts the slowest first; the log prints in declaration order.
const OFF_WIN32 = process.platform === 'win32' ? 0 : 3;
const SECTIONS = [
  { name: 'early', cases: 26, weight: 70 },
  { name: 'promotions', cases: 13, weight: 63 },
  { name: 'revised', cases: 15, weight: 51 },
  { name: 'adopt-basics', cases: 36, weight: 21 },
  { name: 'genesis', cases: 7, weight: 48 },
  { name: 'incremental', cases: 52, weight: 206 },
  { name: 'rereview', cases: 20, weight: 47 },
  { name: 'rewrites', cases: 14 + OFF_WIN32, weight: 35 },
  { name: 'prefix-a', cases: 10, weight: 25 },
  { name: 'prefix-b', cases: 13, weight: 41 },
  { name: 'tail', cases: 48, weight: 134 },
  { name: 'w2', cases: 19, weight: 86 },
];
const expectedCases = process.platform === 'win32' ? 273 : 276;

function usage(message) {
  console.error(`${message}\nusage: run.mjs [--serial | --jobs N] | --section NAME`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { section: null, jobs: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--serial') options.jobs = 1;
    else if (arg === '--jobs' || arg === '--section') {
      const value = argv[index + 1];
      if (value === undefined) usage(`${arg} needs a value`);
      index += 1;
      if (arg === '--section') options.section = value;
      else if (/^[1-9]\d*$/.test(value)) options.jobs = Number(value);
      else usage(`--jobs needs a positive integer, got ${value}`);
    } else usage(`unknown argument ${arg}`);
  }
  return options;
}

// Child mode: run one section and report how many cases and spawns it executed.
async function runOneSection(name) {
  const section = SECTIONS.find((item) => item.name === name);
  if (!section) usage(`unknown section ${name}; known: ${SECTIONS.map((item) => item.name).join(', ')}`);
  const { counts } = await import('./harness.mjs');
  try {
    const { runSection } = await import(`./section-${name}.mjs`);
    runSection();
    const { cases, spawns, failures } = counts();
    if (cases !== section.cases) throw new Error(`expected ${section.cases} cases but executed ${cases}`);
    if (failures.length) throw new Error(failures.join('\n'));
    console.log(`${MARKER}${JSON.stringify({ section: name, cases, spawns })}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : (() => {
      try { return String(error); } catch { return '<unstringifiable thrown value>'; }
    })();
    console.error(`\nrecord-collections section ${name} aborted (${counts().cases}/${section.cases} cases): ${message}`);
    process.exitCode = 1;
  }
}

async function runAll(jobs) {
  const pinned = SECTIONS.reduce((sum, section) => sum + section.cases, 0);
  if (pinned !== expectedCases) {
    console.error(`record-collections eval aborted: sections pin ${pinned} cases but the eval expects ${expectedCases}`);
    process.exitCode = 1;
    return;
  }
  const { cases, spawns, failed } = await runSections(process.argv[1], SECTIONS, { jobs });
  if (failed.length || cases !== expectedCases) {
    console.error(`\nrecord-collections eval failed (${cases}/${expectedCases} cases): ${failed.join('; ') || 'case count differs from the pin'}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nrecord-collections eval passed (${cases}/${expectedCases} cases, ${spawns} spawns, ${SECTIONS.length} sections)`);
}

const options = parseArgs(process.argv.slice(2));
if (options.section) await runOneSection(options.section);
else await runAll(options.jobs);
