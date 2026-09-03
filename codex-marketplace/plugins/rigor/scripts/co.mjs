#!/usr/bin/env node
// One entrypoint over the canonical scripts: `co <domain> <verb> [args...]`.
//
// WHY: skills, evals, and the handbook each spell out `node <root>/scripts/<name>.mjs`, and a
// model that wants a script's flags reads that script's header comment to find them. A single
// verb table replaces both costs: `co --help` lists every entrypoint in one screen, and
// `co scan narration <file>` replaces the long path in every SKILL.md.
//
//   node scripts/co.mjs <domain> <verb> [args...]
//   node scripts/co.mjs --help | <domain> --help
//   node scripts/co.mjs --version
//
// This is a façade, not a rewrite. It moves no logic: it resolves the verb to a SIBLING script
// in its own directory, rewrites `process.argv` to what that script would have seen when
// invoked directly, and imports it. No child process, so start-up cost is one module load and
// the wrapped script's exit code, stdout, and stderr are its own.
//
// A plugin vendors only the scripts its skills use, so a verb can name a script this copy does
// not carry. That is reported, never guessed at.
//
// Exit: 2 = unknown domain, unknown verb, or a verb whose script is not bundled beside this
// file; 0 for --help and --version; otherwise the wrapped script's own exit code.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The verb table. Each verb names a canonical script in scripts/. `sub` marks a
// subcommand-driven script and gives the subcommand to insert when the caller supplied none,
// so `co atlas check --atlas <dir>` reaches `atlas-check.mjs check --atlas <dir>` while
// `co atlas check init --atlas <dir>` passes `init` through untouched.
const TABLE = {
  context: {
    snapshot: 'context-snapshot.mjs',
    bundle: 'context-bundle.mjs',
    map: 'repo-map.mjs',
    graph: 'import-graph.mjs',
    audit: 'context-audit.mjs',
    skim: 'skim.mjs',
    digest: 'digest.mjs',
  },
  run: {
    preflight: 'preflight.mjs',
    ledger: 'dispatch-ledger.mjs',
    receipt: 'run-proof.mjs',
    contract: 'run-contract.mjs',
    runtime: 'run-runtime.mjs',
    capabilities: 'host-capabilities.mjs',
    cost: 'estimate-run-cost.mjs',
    bench: 'benchmark-command.mjs',
  },
  scan: {
    'ai-tells': 'scan-ai-tells.mjs',
    narration: 'scan-narration.mjs',
    redaction: 'scan-redaction.mjs',
    injection: 'scan-injection-tells.mjs',
    autofix: 'check-autofix-scope.mjs',
    overbuild: 'scan-overbuild.mjs',
    deferrals: 'harvest-deferrals.mjs',
  },
  check: {
    vault: 'check-vault-standard.mjs',
    fleet: 'check-fleet.mjs',
    deps: 'check-no-deps.mjs',
    pins: 'check-action-pins.mjs',
    models: 'check-model-registry.mjs',
    bump: 'check-plugin-bump.mjs',
    proofs: 'check-proof-integrity.mjs',
    links: 'check-doc-links.mjs',
    citations: 'check-doc-citations.mjs',
  },
  docs: {
    manifest: 'docs-manifest.mjs',
    extract: 'docs-extract.mjs',
    lib: 'lib-docs.mjs',
    records: 'records.mjs',
  },
  atlas: {
    check: { script: 'atlas-check.mjs', sub: 'check' },
  },
  register: {
    revalidate: 'revalidate-register.mjs',
  },
  calibrate: {
    graph: 'calibration-graph.mjs',
    metrics: 'calibration-metrics.mjs',
    judgment: 'judgment-evals.mjs',
  },
  review: {
    gate: 'local-review-gate.mjs',
  },
  research: {
    manifest: 'research-manifest.mjs',
  },
  build: {
    codex: 'build-codex-marketplace.mjs',
    opencode: 'build-opencode-dist.mjs',
    lint: 'lint-plugins.mjs',
    vendored: 'sync-vendored.mjs',
    bump: 'bump-plugin-version.mjs',
    hooks: 'install-git-hooks.mjs',
  },
};

const entryOf = (v) => (typeof v === 'string' ? { script: v, sub: null } : v);
const domains = () => Object.keys(TABLE);
const verbs = (domain) => Object.keys(TABLE[domain]);

function helpLines(only = null) {
  const lines = [
    'usage: co <domain> <verb> [args...]',
    '       co --help | co <domain> --help | co --version',
    '',
  ];
  for (const domain of domains()) {
    if (only && domain !== only) continue;
    lines.push(`  ${domain}`);
    for (const verb of verbs(domain)) {
      const { script, sub } = entryOf(TABLE[domain][verb]);
      const bundled = existsSync(join(HERE, script)) ? '' : '   (not bundled here)';
      lines.push(`    ${verb.padEnd(12)} ${script}${sub ? ` (${sub} is the default subcommand)` : ''}${bundled}`);
    }
  }
  lines.push('');
  lines.push('Arguments after the verb reach the resolved script unchanged.');
  return lines;
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(2);
}

// The version of the package this copy of co.mjs ships in: the nearest .claude-plugin/plugin.json
// walking up from this file. The repository checkout has no plugin manifest above scripts/, so it
// reports `repo`.
function version() {
  let dir = HERE;
  for (;;) {
    const manifest = join(dir, '.claude-plugin', 'plugin.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
        if (parsed && parsed.version) return `${parsed.name || 'plugin'} ${parsed.version}`;
      } catch { /* an unreadable manifest is not a version claim */ }
    }
    const up = dirname(dir);
    if (up === dir) return 'repo';
    dir = up;
  }
}

const argv = process.argv.slice(2);

if (argv.length === 0) fail(helpLines());
if (argv[0] === '--help' || argv[0] === '-h') {
  console.log(helpLines().join('\n'));
  process.exit(0);
}
if (argv[0] === '--version' || argv[0] === '-v') {
  console.log(version());
  process.exit(0);
}

const domain = argv[0];
if (!Object.hasOwn(TABLE, domain)) {
  fail([`co: unknown domain: ${domain}`, `domains: ${domains().join(', ')}`]);
}
if (argv[1] === '--help' || argv[1] === '-h') {
  console.log(helpLines(domain).join('\n'));
  process.exit(0);
}
const verb = argv[1];
if (verb === undefined || !Object.hasOwn(TABLE[domain], verb)) {
  fail([
    verb === undefined ? `co: ${domain} needs a verb` : `co: unknown verb: ${domain} ${verb}`,
    `${domain} verbs: ${verbs(domain).join(', ')}`,
  ]);
}

const { script, sub } = entryOf(TABLE[domain][verb]);
const target = resolve(HERE, script);
if (!existsSync(target)) {
  fail([`co: ${domain} ${verb} is not bundled in this plugin (${script})`]);
}

const rest = argv.slice(2);
// A subcommand-driven script keeps its own grammar. Insert the default subcommand only when the
// caller opened with a flag or supplied nothing, so an explicit subcommand always wins.
if (sub && (rest.length === 0 || rest[0].startsWith('-'))) rest.unshift(sub);

// What the script would have seen if the caller had run it directly. Scripts that detect being
// the entry point compare argv[1] against their own module URL, so it must be the resolved path.
process.argv = [process.argv[0], target, ...rest];

// Deliberately unguarded: the wrapped script owns its exit code and its exceptions. The only
// failure this file translates is the missing sibling, checked above.
await import(pathToFileURL(target).href);
