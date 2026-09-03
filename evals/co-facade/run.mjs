#!/usr/bin/env node
// Façade regression eval — pins the single entrypoint (scripts/co.mjs) and the shared CLI
// library (scripts/cli-lib.mjs):
//   - `co --help` exits 0 and lists every domain the table declares, so a new domain cannot
//     be added without appearing in the help the model reads;
//   - a wrapped verb produces byte-identical stdout and the same exit code as calling the
//     script directly (the façade rewrites argv, it does not reformat anything);
//   - an unknown domain and an unknown verb both exit 2, and the unknown verb names the
//     valid verbs for its domain instead of a bare refusal;
//   - a subcommand-driven verb reaches its script with the default subcommand inserted, and
//     an explicit subcommand still passes through;
//   - `co.mjs` copied alone into an empty directory reports the missing sibling as
//     not-bundled with exit 2, which is what a plugin that vendors a partial script set does;
//   - parseFlags separates flags from positionals and throws UsageError on an unknown flag,
//     a prototype-named flag, a flag whose value is missing, or a flag-shaped value.
//
//   node evals/co-facade/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const co = join(root, 'scripts', 'co.mjs');
const cliLib = join(root, 'scripts', 'cli-lib.mjs');

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };
const run = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', cwd: root, ...opts });

// The domains the eval knows about. Pinned here rather than read from co.mjs so that removing
// a domain from the table fails this eval instead of silently shrinking the expectation.
const DOMAINS = ['context', 'run', 'scan', 'check', 'docs', 'atlas', 'register', 'calibrate', 'review', 'research', 'build'];

// The table's own top-level keys, read from the source, must equal the pinned list. A new
// domain has to be added here too, which is the point.
const source = readFileSync(co, 'utf8');
const tableBlock = source.slice(source.indexOf('const TABLE = {'), source.indexOf('\n};', source.indexOf('const TABLE = {')));
const tableDomains = [...tableBlock.matchAll(/^ {2}([a-z][a-z-]*): \{$/gm)].map((m) => m[1]);
expect(tableDomains.join(',') === DOMAINS.join(','), `table domains ${JSON.stringify(tableDomains)} must equal the pinned list ${JSON.stringify(DOMAINS)}`);

// --help lists every domain and exits 0.
const help = run([co, '--help']);
expect(help.status === 0, `--help should exit 0, got ${help.status}: ${help.stderr}`);
for (const domain of DOMAINS) expect(new RegExp(`^ {2}${domain}$`, 'm').test(help.stdout), `--help must list the ${domain} domain`);
expect(/co <domain> <verb>/.test(help.stdout), '--help must show the invocation form');

// A domain's own help narrows to that domain.
const scanHelp = run([co, 'scan', '--help']);
expect(scanHelp.status === 0, `co scan --help should exit 0, got ${scanHelp.status}`);
expect(/^ {2}scan$/m.test(scanHelp.stdout) && !/^ {2}build$/m.test(scanHelp.stdout), 'co scan --help must show only the scan domain');

// --version reports the package this copy ships in; the repository checkout has no plugin
// manifest above scripts/, so it reports `repo`.
const version = run([co, '--version']);
expect(version.status === 0 && version.stdout.trim() === 'repo', `--version from the repository checkout should print repo, got ${version.status}/${version.stdout.trim()}`);

// A wrapped verb is byte-identical to the direct invocation.
const fixture = 'evals/scan-narration/clean.md';
const viaFacade = run([co, 'scan', 'narration', fixture]);
const direct = run([join(root, 'scripts', 'scan-narration.mjs'), fixture]);
expect(viaFacade.status === 0, `co scan narration should exit 0, got ${viaFacade.status}: ${viaFacade.stderr}`);
expect(viaFacade.status === direct.status, `exit code must match the direct call: ${viaFacade.status} vs ${direct.status}`);
expect(viaFacade.stdout === direct.stdout, 'stdout must match the direct call byte for byte');

// A verb that takes no arguments still resolves.
const deps = run([co, 'check', 'deps']);
expect(deps.status === 0, `co check deps should exit 0, got ${deps.status}: ${deps.stderr}`);

// Unknown domain and unknown verb both exit 2; the verb error names the domain's verbs.
const badDomain = run([co, 'nope']);
expect(badDomain.status === 2, `co nope should exit 2, got ${badDomain.status}`);
expect(/unknown domain: nope/.test(badDomain.stderr), 'unknown domain must be named');
const badVerb = run([co, 'scan', 'nope']);
expect(badVerb.status === 2, `co scan nope should exit 2, got ${badVerb.status}`);
for (const verb of ['ai-tells', 'narration', 'redaction', 'injection', 'autofix']) {
  expect(badVerb.stderr.includes(verb), `unknown verb must list the valid verb ${verb}`);
}
expect(run([co, 'scan']).status === 2, 'a domain with no verb should exit 2');

// A subcommand-driven verb: the default subcommand is inserted when the caller opened with a
// flag, and an explicit subcommand still wins.
const atlasDir = 'code-ops-docs/98 System/Atlas';
const atlas = run([co, 'atlas', 'check', '--atlas', atlasDir]);
expect(atlas.status === 0, `co atlas check --atlas should exit 0, got ${atlas.status}: ${atlas.stderr}`);
const atlasDirect = run([join(root, 'scripts', 'atlas-check.mjs'), 'check', '--atlas', atlasDir]);
expect(atlas.stdout === atlasDirect.stdout, 'co atlas check must match atlas-check.mjs check byte for byte');
const atlasBadSub = run([co, 'atlas', 'check', 'nosuchsubcommand', '--atlas', atlasDir]);
expect(atlasBadSub.status === 2, `an explicit subcommand must pass through to atlas-check.mjs, got ${atlasBadSub.status}`);

// co.mjs alone in an empty directory: every verb's script is a missing sibling.
const lone = mkdtempSync(join(tmpdir(), 'co-lone-'));
copyFileSync(co, join(lone, 'co.mjs'));
const unbundled = run([join(lone, 'co.mjs'), 'scan', 'narration', 'x']);
expect(unbundled.status === 2, `an unbundled verb should exit 2, got ${unbundled.status}`);
expect(unbundled.stderr.includes('co: scan narration is not bundled in this plugin (scan-narration.mjs)'), `unbundled message, got: ${unbundled.stderr.trim()}`);
const loneHelp = run([join(lone, 'co.mjs'), '--help']);
expect(loneHelp.status === 0 && /not bundled here/.test(loneHelp.stdout), 'help from a partial copy must mark the missing verbs');

// cli-lib: flag parsing, positionals, and the two UsageError paths.
const probe = join(lone, 'probe.mjs');
writeFileSync(probe, `
import { parseFlags, UsageError } from ${JSON.stringify(pathToFileURL(cliLib).href)};
const out = {};
const r = parseFlags(['--a', '1', '--b', 'pos'], { a: { value: true }, b: { value: false } });
out.flags = r.flags;
out.positional = r.positional;
try { parseFlags(['--zzz'], { a: { value: true } }); out.unknown = 'no throw'; }
catch (e) { out.unknown = e instanceof UsageError ? e.name : 'wrong type'; }
try { parseFlags(['--a'], { a: { value: true } }); out.missing = 'no throw'; }
catch (e) { out.missing = e instanceof UsageError ? e.name : 'wrong type'; }
try { parseFlags([], { a: { value: true, required: true } }); out.required = 'no throw'; }
catch (e) { out.required = e instanceof UsageError ? e.name : 'wrong type'; }
try { parseFlags(['--constructor'], { a: { value: true } }); out.proto = 'no throw'; }
catch (e) { out.proto = e instanceof UsageError ? e.name : 'wrong type'; }
try { parseFlags(['--a', '--b'], { a: { value: true }, b: { value: false } }); out.flagValue = 'no throw'; }
catch (e) { out.flagValue = e instanceof UsageError ? e.name : 'wrong type'; }
out.defaulted = parseFlags([], { a: { value: true, default: 'd' } }).flags.a;
out.terminator = parseFlags(['--', '--a'], { a: { value: false } }).positional;
process.stdout.write(JSON.stringify(out));
`);
const probeRun = run([probe]);
expect(probeRun.status === 0, `cli-lib probe should exit 0, got ${probeRun.status}: ${probeRun.stderr}`);
let parsed = null;
try { parsed = JSON.parse(probeRun.stdout); } catch { fails.push('cli-lib probe output must parse'); }
if (parsed) {
  expect(parsed.flags && parsed.flags.a === '1' && parsed.flags.b === true, `parseFlags flags {a:'1',b:true}, got ${JSON.stringify(parsed.flags)}`);
  expect(Array.isArray(parsed.positional) && parsed.positional.length === 1 && parsed.positional[0] === 'pos', `parseFlags positional ['pos'], got ${JSON.stringify(parsed.positional)}`);
  expect(parsed.unknown === 'UsageError', `an unknown flag must throw UsageError, got ${parsed.unknown}`);
  expect(parsed.missing === 'UsageError', `a missing value must throw UsageError, got ${parsed.missing}`);
  expect(parsed.required === 'UsageError', `a missing required flag must throw UsageError, got ${parsed.required}`);
  expect(parsed.proto === 'UsageError', `a prototype-named flag must throw UsageError, got ${parsed.proto}`);
  expect(parsed.flagValue === 'UsageError', `a flag-shaped value must throw UsageError, got ${parsed.flagValue}`);
  expect(parsed.defaulted === 'd', `an absent flag takes its default, got ${parsed.defaulted}`);
  expect(Array.isArray(parsed.terminator) && parsed.terminator.join(',') === '--a', `-- ends flag parsing, got ${JSON.stringify(parsed.terminator)}`);
}

rmSync(lone, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\nco-facade eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('ok   help lists every table domain; a wrapped verb matches the direct call exactly');
console.log('ok   unknown domain and verb exit 2; an unbundled verb names its missing script');
console.log('ok   cli-lib parses flags and positionals and throws UsageError on caller error');
console.log('\nco-facade eval passed');
