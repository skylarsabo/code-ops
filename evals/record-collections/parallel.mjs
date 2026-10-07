// Runs the record-collections eval sections as parallel child processes. A section passes only when
// its child exits 0 on its own, reports the exact case count the caller pins for it, and prints
// its closing marker. A crash, a signal kill, a missing marker, or a short count fails the run.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

export const MARKER = '@@section-result ';

// Sections never share state, so the limit only bounds how many git-heavy children compete for cores.
export function defaultJobs(sectionCount) {
  return Math.min(sectionCount, Math.max(2, availableParallelism()));
}

// The child prints one marker line last. Anything else on stdout is the section's own log.
export function parseMarker(stdout) {
  const line = stdout.split(/\r?\n/).reverse().find((text) => text.startsWith(MARKER));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice(MARKER.length));
    return Number.isInteger(value?.cases) && Number.isInteger(value?.spawns) ? value : null;
  } catch { return null; }
}

function runChild(script, section) {
  const started = Date.now();
  const finish = (code, signal, text) => ({ section, code, signal, text, seconds: (Date.now() - started) / 1000 });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--section', section.name], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => resolve(finish(null, null, `${error.message}\n`)));
    child.on('close', (code, signal) => resolve(finish(code, signal, Buffer.concat(chunks).toString('utf8'))));
  });
}

// Why one finished child counts as a failure, or null when it passed.
export function sectionProblem({ section, code, signal, text }) {
  if (signal) return `killed by ${signal}`;
  if (code !== 0) return `exited ${code}`;
  const marker = parseMarker(text);
  if (!marker) return 'closing marker missing';
  if (marker.cases !== section.cases) return `reported ${marker.cases} cases, declared ${section.cases}`;
  return null;
}

function printSection(result, log) {
  const verdict = result.problem ? `FAILED (${result.problem})` : 'passed';
  log(`\n=== section ${result.section.name}: ${verdict}, ${result.section.cases} cases declared, ${result.seconds.toFixed(1)} s ===`);
  for (const line of result.text.split(/\r?\n/)) {
    if (line && !line.startsWith(MARKER)) log(line);
  }
}

// Starts every section through a bounded pool. A section's buffered log prints once it and every
// section declared before it have finished, so the log order matches a serial run whatever the
// finish order. Returns the totals plus the failing sections, so the caller owns the exit code.
export async function runSections(script, sections, { jobs = defaultJobs(sections.length), log = console.log } = {}) {
  // Start the slowest sections first so one long section never begins last; output order stays as declared.
  const queue = sections.map((section, index) => ({ section, index })).sort((left, right) => (right.section.weight ?? 0) - (left.section.weight ?? 0));
  const results = new Array(sections.length);
  const failed = [];
  let printed = 0;
  const flush = () => {
    for (; printed < results.length && results[printed]; printed += 1) {
      printSection(results[printed], log);
      if (results[printed].problem) failed.push(`${results[printed].section.name}: ${results[printed].problem}`);
    }
  };
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await runChild(script, next.section);
      results[next.index] = { ...result, problem: sectionProblem(result), marker: parseMarker(result.text) };
      flush();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, sections.length)) }, worker));
  const cases = results.reduce((sum, result) => sum + (result.marker?.cases ?? 0), 0);
  const spawns = results.reduce((sum, result) => sum + (result.marker?.spawns ?? 0), 0);
  return { cases, spawns, failed, results };
}
