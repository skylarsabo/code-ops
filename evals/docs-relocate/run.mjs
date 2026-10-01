#!/usr/bin/env node
// Docs relocation regression eval (scripts/docs-relocate.mjs, `co docs relocate`, docs gate step 6).
//
// The fixture is a manifest v3 repository built in a temp directory. Its legacy `docs/` tree holds
// a rulings record collection, an audit record collection, two specs and a live register, and a
// machine manifest that `src/tool.mjs` reads. A PROGRAM.md and a HANDOFF.md name old paths, and
// AGENTS.md and a README cite them in prose. The cases pin:
//   - plan: the routing of each file kind, the runtime-read and prose reference lists, the default
//     legacy roots, and the two plan files;
//   - apply refusals: a dirty tree, a base older than the plan, a plan that no longer matches;
//   - apply, four waves: git mv keeps renames, one relocate-root event per collection, the manifest
//     root and `removed` disposition, FORWARDING.json, rewritten references, a runtime read that
//     still runs, history bytes untouched, the record chain still passing, and a passing gate;
//   - gate step 6: pass, fail on a stale reference, and a stable ratchet key (the docs-gate eval owns
//     the invalid FORWARDING.json and removed-root cases);
//   - forward: files added under a removed root move through FORWARDING.json and the plan,
//     references rewrite, a file with no route exits 1 naming it, and nothing moves;
//   - the `co docs relocate` facade and the integrate-branch step condition.
//
// The stub guard: the plan, refusal, and gate cases run against a stub that always exits 0 and a
// stub that always exits 1. A case that passes both asserts nothing, so it fails this eval.
//
//   node evals/docs-relocate/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
const RELOCATE = join(SCRIPTS, 'docs-relocate.mjs');
const HUB = 'project-docs';
const AT = '2026-09-30T00:00:00.000Z';
const work = mkdtempSync(join(tmpdir(), 'coh-docs-relocate-'));
const { fails, check } = tally(withDetail);

const node = (args, cwd) => {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const git = (repo, ...args) => {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', ...args], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
const put = (repo, rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const read = (repo, rel) => readFileSync(join(repo, rel), 'utf8');
const readJson = (repo, rel) => JSON.parse(read(repo, rel));
const commit = (repo, message) => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', message); };
const note = (title, status = 'current') => `---\ntype: note\nstatus: ${status}\nupdated: 2026-09-29\n---\n\n# ${title}\n`;
const spec = (title, status, body = '') => `---\ntype: spec\nstatus: ${status}\nupdated: 2026-09-29\n---\n\n# ${title}\n\n${body}\n`;
const ledgerLines = (repo, name) => (existsSync(join(repo, HUB, '98 System', 'Records', name))
  ? read(repo, `${HUB}/98 System/Records/${name}`).split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

const COLLECTIONS = [
  { id: 'rulings', uuid: '33333333-3333-4333-8333-333333333331', root: 'docs/rulings' },
  { id: 'audit', uuid: '33333333-3333-4333-8333-333333333332', root: 'docs/audit' },
];
const PROGRAM = '# PROGRAM: alpha\n\nGrammar: 2\n\n## Program goal\n\nScope: legacy/findings-register.md and docs/rulings/r1.md hold the open items.\n\n## Decisions ledger\n\n- DEC-1 2026-09-29 Keep docs/audit as it is · Hop: 0 · Disposition: local\n';
const HANDOFF = '# HANDOFF: alpha\n\n## Program\n\nProgram: runs/programs/alpha/PROGRAM.md\nPredecessor: none\nSession: Alpha HO 1\nHop: 1\n\nRead docs/rulings/r1.md first.\n';

// A manifest v3 hub whose legacy `docs/` tree is adopted, stamped, and committed.
function buildRepo(name) {
  const repo = join(work, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '-b', 'main');
  put(repo, '.gitignore', `${HUB}/80 Runs/\n`);
  put(repo, 'src/main.txt', 'source\n');
  put(repo, 'src/tool.mjs', "import { readFileSync } from 'node:fs';\n// The tool table lives in legacy/tools.json.\nconsole.log(JSON.parse(readFileSync('legacy/tools.json', 'utf8')).name);\n");
  put(repo, 'AGENTS.md', '# Agents\n\nRulings live in docs/rulings and audits in docs/audit. See legacy/plan.md and docs/OLD.md.\n\nThe legacy tree is reviewed monthly.\n');
  put(repo, 'README.md', '# Fixture\n\nSee docs/rulings/r1.md.\n');
  put(repo, `${HUB}/Standard.md`, '---\ntype: standard\nstatus: current\nupdated: 2026-09-29\nstandard-version: 5\n---\n\n# Standard\n');
  put(repo, `${HUB}/00 Home.md`, note('Home'));
  put(repo, `${HUB}/README.md`, '# Fixture hub\n');
  for (const dir of ['00 Inbox', '90 Templates', '95 Attachments', '99 Archive']) put(repo, `${HUB}/${dir}/.gitkeep`, '');
  const required = ['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas'];
  for (const id of required) put(repo, `${HUB}/40 Engineering/${id}.md`, note(id));
  // The audit records carry no note frontmatter: record bytes are immutable, so the vault standard exempts a collection root inside the hub.
  put(repo, 'docs/rulings/r1.md', `${note('Ruling 1')}\nKeep one ledger.\n`);
  put(repo, 'docs/rulings/r2.md', `${note('Ruling 2')}\nSee docs/rulings/r1.md.\n`);
  put(repo, 'docs/audit/a1.md', '# Audit 1\n');
  put(repo, 'docs/audit/sub/a2.md', '# Audit 2\n');
  put(repo, 'legacy/plan.md', spec('Plan', 'current', 'The tool table is legacy/tools.json.'));
  put(repo, 'legacy/old.md', '---\ntype: spec\nstatus: superseded\nsuperseded-by: "[[plan]]"\nupdated: 2026-09-29\n---\n\n# Old plan\n');
  put(repo, 'legacy/findings-register.md', spec('Findings register', 'current'));
  put(repo, 'docs/OLD.md', '<!-- generated by records.mjs legacy-pointer v1 -->\n[Canonical documentation](<../project-docs/40%20Engineering/guides.md>)\n');
  put(repo, 'legacy/tools.json', '{"name":"tool-table"}\n');
  put(repo, 'runs/programs/alpha/PROGRAM.md', PROGRAM);
  put(repo, 'runs/programs/alpha/HANDOFF.md', HANDOFF);
  // A generated pointer stub for a doc whose canonical copy already lives in the hub. AGENTS.md is its evidence.
  const pointer = { path: 'docs/OLD.md', disposition: 'pointer', target: `${HUB}/40 Engineering/guides.md`, requiredBy: [{ kind: 'external', ref: 'AGENTS.md' }] };
  put(repo, `${HUB}/98 System/DOCS_MANIFEST.json`, `${JSON.stringify({
    version: 3, hub: HUB, runs: { tracking: 'ignored', retain: [] }, drafts: { maxAgeDays: 30, statuses: ['draft', 'current', 'superseded', 'archived'] }, state: {},
    recordCollections: COLLECTIONS.map((c) => ({
      id: c.id, collectionUuid: c.uuid, identityVersion: 1, root: c.root,
      inventory: `98 System/Records/${c.id}-inventory.json`, citations: `98 System/Records/${c.id}-citations.json`,
      curationLedger: `98 System/Records/${c.id}-curation.jsonl`, index: `98 System/Records/${c.id}-index.md`,
      scopes: [{ pattern: '**/*.md', kind: 'record', policy: 'append-only' }],
    })),
    legacyPaths: [pointer],
    domains: required.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: ['src/**'], sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  commit(repo, 'seed');
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  for (const { id } of COLLECTIONS) {
    let r = node([join(SCRIPTS, 'records.mjs'), 'plan-adoption', '--root', repo, '--collection', id, '--out', 'adoption-review.json'], repo);
    if (r.status !== 0) throw new Error(`plan-adoption ${id} failed: ${r.all}`);
    const adoption = readJson(repo, 'adoption-review.json');
    for (const candidate of adoption.candidates) {
      if (candidate.adoptionReadiness !== 'review-required') continue;
      candidate.disposition = 'freeze-current';
      candidate.rationale = 'The reviewed bytes are the intended immutable baseline.';
    }
    writeFileSync(join(repo, 'adoption-review.json'), `${JSON.stringify(adoption, null, 2)}\n`);
    r = node([join(SCRIPTS, 'records.mjs'), 'adopt', '--root', repo, '--collection', id, '--review', 'adoption-review.json'], repo);
    if (r.status !== 0) throw new Error(`adopt ${id} failed: ${r.all}`);
    commit(repo, `adopt ${id}`);
  }
  const triage = node([join(SCRIPTS, 'check-vault-standard.mjs'), join(repo, HUB), '--render'], repo);
  if (triage.status !== 0) throw new Error(`vault render failed: ${triage.all}`);
  const sync = node([join(SCRIPTS, 'docs-manifest.mjs'), 'sync', '--root', repo], repo);
  if (sync.status !== 0) throw new Error(`fixture manifest sync failed: ${sync.all}`);
  commit(repo, 'stamp');
  return repo;
}

const WAVES = ['docs/rulings', 'docs/audit', 'docs/OLD.md', 'legacy'];
const LEGACY = WAVES.flatMap((wave) => ['--legacy', wave]);

// The plan, refusal, and gate cases against one script. The apply and forward cases follow the suite.
function suite(script, tag, repo) {
  const results = [];
  const test = (name, ok) => results.push({ name, ok: Boolean(ok) });
  const runDir = join(work, `${tag}-run`);
  const planFile = join(runDir, 'RELOCATION_PLAN.json');
  const plan = (args = LEGACY, cwd = repo) => node([script, 'plan', '--root', cwd, '--run', runDir, ...args], cwd);
  const apply = (args, cwd = repo) => node([script, 'apply', '--root', cwd, '--at', AT, ...args], cwd);

  let r = plan();
  const doc = existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : { rows: [], roots: [], references: { runtime: [], prose: [], unresolved: [] }, conflicts: [] };
  const row = (source) => doc.rows.find((x) => x.source === source);
  test('plan writes the markdown and JSON plan in the run folder', r.status === 0 && existsSync(join(runDir, 'RELOCATION_PLAN.md')) && doc.rows.length === 9
    && /\| docs\/rulings\/r1\.md \|/.test(existsSync(join(runDir, 'RELOCATION_PLAN.md')) ? readFileSync(join(runDir, 'RELOCATION_PLAN.md'), 'utf8') : ''));
  test('plan records the base HEAD and one wave per legacy root', doc.base === git(repo, 'rev-parse', 'HEAD').trim() && doc.roots.map((x) => x.root).join() === [...WAVES].sort().join());
  test('a rulings collection routes whole to 20 Decisions/Records/<id>', row('docs/rulings/r1.md')?.target === `${HUB}/20 Decisions/Records/rulings/r1.md` && row('docs/rulings/r1.md')?.kind === 'collection-rulings');
  test('an audit collection routes whole to 99 Archive/Audit and keeps subpaths, one level down when a loose file routes there', row('docs/audit/sub/a2.md')?.target === `${HUB}/99 Archive/Audit/audit/sub/a2.md` && row('docs/audit/a1.md')?.kind === 'collection-audit');
  test('a current spec routes to 10 Design/Specs and a superseded spec to 99 Archive/Specs',
    row('legacy/plan.md')?.target === `${HUB}/10 Design/Specs/plan.md` && row('legacy/old.md')?.target === `${HUB}/99 Archive/Specs/old.md` && row('legacy/old.md')?.kind === 'spec-archived');
  test('a register named by an open program routes to 99 Archive/Audit flagged for promotion',
    row('legacy/findings-register.md')?.target === `${HUB}/99 Archive/Audit/findings-register.md` && row('legacy/findings-register.md')?.promote === true);
  test('a machine manifest routes to 35 Contracts and Data/Manifests and is marked a runtime read',
    row('legacy/tools.json')?.target === `${HUB}/35 Contracts and Data/Manifests/tools.json` && row('legacy/tools.json')?.runtimeRead === true);
  test('every row names a source, a target, a kind, and a reason', doc.rows.length > 0 && doc.rows.every((x) => x.source && x.target && x.kind && x.reason));
  test('code that opens a path is a runtime read', doc.references.runtime.some((x) => x.file === 'src/tool.mjs' && x.path === 'legacy/tools.json' && x.line === 3));
  test('a comment and a Markdown note are prose', doc.references.prose.some((x) => x.file === 'src/tool.mjs' && x.line === 2) && doc.references.prose.some((x) => x.file === 'AGENTS.md')
    && !doc.references.runtime.some((x) => x.file === 'AGENTS.md'));
  test('the plan skips history: no PROGRAM.md or HANDOFF.md reference, no record bytes',
    doc.rows.length === 9 && ![...doc.references.runtime, ...doc.references.prose].some((x) => /PROGRAM|HANDOFF|^docs\/rulings\//.test(x.file)) && doc.conflicts.length === 0 && doc.references.unresolved.length === 0);
  const defaults = plan([]);
  const defaultDoc = existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : { roots: [] };
  test('with no --legacy the roots are the collection roots and the legacyPaths entries',
    defaults.status === 0 && defaultDoc.roots.map((x) => x.root).join() === ['docs/OLD.md', 'docs/audit', 'docs/rulings'].join());
  test('a pointer stub is removed and forwarded to its manifest target, not moved',
    row('docs/OLD.md')?.kind === 'legacy-pointer' && row('docs/OLD.md')?.remove === true && row('docs/OLD.md')?.target === `${HUB}/40 Engineering/guides.md`);
  plan();

  // Refusals. Each starts from the reviewed plan.
  put(repo, 'scratch.txt', 'dirty\n');
  r = apply(['--plan', planFile, '--wave', 'docs/rulings']);
  test('apply refuses a dirty tree and moves nothing', r.status === 1 && /dirty/.test(r.err) && existsSync(join(repo, 'docs/rulings/r1.md')));
  rmSync(join(repo, 'scratch.txt'));

  const stale = join(work, `${tag}-stale`);
  cpSync(repo, stale, { recursive: true });
  git(stale, 'commit', '-q', '--allow-empty', '-m', 'newer base');
  const stalePlan = join(work, `${tag}-stale-plan`);
  node([script, 'plan', '--root', stale, '--run', stalePlan, ...LEGACY], stale);
  git(stale, 'reset', '--quiet', '--hard', 'HEAD~1');
  r = apply(['--plan', join(stalePlan, 'RELOCATION_PLAN.json'), '--wave', 'docs/rulings'], stale);
  test('apply refuses a base older than the plan', r.status === 1 && /older than the plan/.test(r.err) && existsSync(join(stale, 'docs/rulings/r1.md')));

  const drift = join(work, `${tag}-drift`);
  cpSync(repo, drift, { recursive: true });
  put(drift, 'legacy/added.md', spec('Added later', 'current'));
  commit(drift, 'add a spec after the plan');
  r = apply(['--plan', planFile, '--wave', 'legacy'], drift);
  test('apply refuses a plan that no longer matches the tracked files', r.status === 1 && /plan is stale: legacy\/added\.md/.test(r.err) && existsSync(join(drift, 'legacy/plan.md')));

  r = apply(['--plan', planFile]);
  test('apply with several waves and no --wave names the waves', r.status === 1 && /name one with --wave/.test(r.err));

  // A version 2 manifest cannot carry a removed legacy root. Plan and apply refuse it with one message that names the upgrade.
  const v2 = join(work, `${tag}-v2`);
  cpSync(repo, v2, { recursive: true });
  const v2Manifest = join(v2, HUB, '98 System', 'DOCS_MANIFEST.json');
  writeFileSync(v2Manifest, `${JSON.stringify({ ...JSON.parse(readFileSync(v2Manifest, 'utf8')), version: 2 }, null, 2)}\n`);
  commit(v2, 'manifest version 2');
  const v2Run = join(work, `${tag}-v2-run`);
  const upgrade = /the manifest is version 2; a removed legacy root needs version 3\. Upgrade it first: .*standard-version 5/;
  r = node([script, 'plan', '--root', v2, '--run', v2Run, ...LEGACY], v2);
  test('plan refuses a version 2 manifest with the upgrade named and writes no plan', r.status === 1 && /plan refused: /.test(r.err) && upgrade.test(r.err) && !existsSync(join(v2Run, 'RELOCATION_PLAN.json')));
  r = apply(['--plan', planFile, '--wave', 'docs/rulings'], v2);
  test('apply refuses a version 2 manifest with the same upgrade message', r.status === 1 && /apply refused: /.test(r.err) && upgrade.test(r.err) && existsSync(join(v2, 'docs/rulings/r1.md')));
  return { results, planFile };
}

const passStub = join(work, 'stub-pass.mjs');
const failStub = join(work, 'stub-fail.mjs');
writeFileSync(passStub, 'process.exit(0);\n');
writeFileSync(failStub, 'process.exit(1);\n');

try {
  const repo = buildRepo('real-repo');
  const real = suite(RELOCATE, 'real', repo);
  const passRun = suite(passStub, 'pass', buildStubRepo('pass-repo'));
  const failRun = suite(failStub, 'fail', buildStubRepo('fail-repo'));
  real.results.forEach((c, i) => {
    check(c.name, c.ok);
    check(`${c.name} (fails against a stub script)`, passRun.results[i].name === c.name && !(passRun.results[i].ok && failRun.results[i].ok), 'passes both the always-pass and the always-fail stub');
  });
  const planFile = real.planFile;
  const baseHead = git(repo, 'rev-parse', 'HEAD').trim();
  const before = new Map(['runs/programs/alpha/PROGRAM.md', 'runs/programs/alpha/HANDOFF.md'].map((p) => [p, read(repo, p)]));
  const recordBytes = new Map(['docs/rulings/r1.md', 'docs/rulings/r2.md', 'docs/audit/a1.md', 'docs/audit/sub/a2.md'].map((p) => [p, read(repo, p)]));
  const apply = (wave, cwd = repo) => node([RELOCATE, 'apply', '--root', cwd, '--plan', planFile, '--wave', wave, '--at', AT], cwd);
  const records = (id, ...args) => node([join(SCRIPTS, 'records.mjs'), ...args, '--root', repo, '--collection', id], repo);
  const gate = (args = [], cwd = repo) => node([join(SCRIPTS, 'docs-gate.mjs'), '--root', cwd, ...args], cwd);
  const branchName = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  git(repo, 'branch', 'prewave');

  // ---- wave 1: the rulings collection ----
  let r = apply('docs/rulings');
  check('apply wave 1 succeeds and prints a commit message', r.status === 0 && /Suggested commit message/.test(r.out) && /Relocate docs\/rulings into project-docs/.test(r.out), r.all);
  const rulingsTarget = `${HUB}/20 Decisions/Records/rulings`;
  check('wave 1 moves the collection whole and drops the old root', existsSync(join(repo, rulingsTarget, 'r1.md')) && existsSync(join(repo, rulingsTarget, 'r2.md')) && !existsSync(join(repo, 'docs/rulings')));
  check('wave 1 leaves record bytes identical', read(repo, `${rulingsTarget}/r1.md`) === recordBytes.get('docs/rulings/r1.md') && read(repo, `${rulingsTarget}/r2.md`) === recordBytes.get('docs/rulings/r2.md'));
  let manifest = readJson(repo, `${HUB}/98 System/DOCS_MANIFEST.json`);
  check('wave 1 sets the collection root and marks the legacy root removed',
    manifest.recordCollections.find((c) => c.id === 'rulings')?.root === rulingsTarget
    && manifest.legacyPaths.some((e) => e.path === 'docs/rulings' && e.disposition === 'removed' && !('target' in e) && e.requiredBy.length > 0));
  const events = ledgerLines(repo, 'rulings-curation.jsonl');
  check('wave 1 appends exactly one relocate-root event for the collection', events.filter((e) => e.type === 'relocate-root').length === 1
    && events.at(-1).fromRoot === 'docs/rulings' && events.at(-1).toRoot === rulingsTarget && ledgerLines(repo, 'audit-curation.jsonl').length === 0);
  let forwarding = readJson(repo, `${HUB}/98 System/FORWARDING.json`);
  check('wave 1 writes FORWARDING.json with one prefix entry', forwarding.version === 1 && forwarding.forwards.length === 1
    && forwarding.forwards[0].from === 'docs/rulings' && forwarding.forwards[0].to === rulingsTarget);
  check('wave 1 rewrites references in AGENTS.md, README.md, and a spec',
    read(repo, 'AGENTS.md').includes(`${rulingsTarget} and audits in docs/audit`) && read(repo, 'README.md').includes(`${rulingsTarget}/r1.md`) && !/docs\/rulings/.test(read(repo, 'AGENTS.md')));
  check('wave 1 leaves PROGRAM.md and HANDOFF.md byte-identical', [...before].every(([p, text]) => read(repo, p) === text));
  const rulingsCheck = records('rulings', 'check');
  const rulingsHistory = records('rulings', 'verify-history', '--strict');
  check('the record chain still passes check and strict history verification after wave 1', rulingsCheck.status === 0 && rulingsHistory.status === 0, rulingsCheck.all + rulingsHistory.all);
  commit(repo, 'wave 1');
  const renames = git(repo, 'diff', '--name-status', '-M', 'HEAD~1', 'HEAD').split('\n').filter((l) => /^R100\tdocs\/rulings\//.test(l));
  check('git records the moved records as 100 percent renames', renames.length === 2, renames.join('|'));

  // ---- waves 2 to 4 ----
  for (const wave of WAVES.slice(1)) {
    r = apply(wave);
    check(`apply wave ${wave} succeeds`, r.status === 0, r.all);
    commit(repo, `wave ${wave}`);
    if (wave === 'docs/OLD.md') {
      // A loose file aimed into the moved audit collection would be an unadmitted record, so apply refuses it.
      const conflictRepo = join(work, 'conflict-repo');
      cpSync(repo, conflictRepo, { recursive: true });
      const edited = JSON.parse(readFileSync(planFile, 'utf8'));
      edited.rows.find((x) => x.source === 'legacy/plan.md').target = `${HUB}/99 Archive/Audit/audit/plan.md`;
      const conflictPlan = join(work, 'conflict-plan.json');
      writeFileSync(conflictPlan, JSON.stringify(edited));
      const refused = node([RELOCATE, 'apply', '--root', conflictRepo, '--plan', conflictPlan, '--wave', 'legacy', '--at', AT], conflictRepo);
      check('apply refuses a loose file routed into a record collection root and moves nothing',
        refused.status === 1 && /sits inside record collection root/.test(refused.err) && existsSync(join(conflictRepo, 'legacy/plan.md')), refused.all);
    }
  }
  check('the pointer wave removes the stub and rewrites prose that names it', !existsSync(join(repo, 'docs/OLD.md')) && read(repo, 'AGENTS.md').includes(`and ${HUB}/40 Engineering/guides.md.`));
  check('the emptied legacy folders are gone from disk after git mv', !existsSync(join(repo, 'docs')) && !existsSync(join(repo, 'legacy')));
  check('a one-word root in prose is not a reference', read(repo, 'AGENTS.md').includes('The legacy tree is reviewed monthly.') && read(repo, 'AGENTS.md').includes(`See ${HUB}/10 Design/Specs/plan.md`));
  const auditTarget = `${HUB}/99 Archive/Audit/audit`;
  check('the audit collection lands beside the loose register in 99 Archive/Audit with subpaths and unchanged bytes',
    read(repo, `${auditTarget}/sub/a2.md`) === recordBytes.get('docs/audit/sub/a2.md') && read(repo, `${auditTarget}/a1.md`) === recordBytes.get('docs/audit/a1.md') && !existsSync(join(repo, 'docs/audit')));
  check('the spec wave routes each file through the plan', existsSync(join(repo, HUB, '10 Design/Specs/plan.md')) && existsSync(join(repo, HUB, '99 Archive/Specs/old.md'))
    && existsSync(join(repo, HUB, '99 Archive/Audit/findings-register.md')) && !existsSync(join(repo, 'legacy')));
  check('a spec reference is rewritten when its target moves in a later wave', read(repo, `${HUB}/10 Design/Specs/plan.md`).includes(`${HUB}/35 Contracts and Data/Manifests/tools.json`));
  const tool = node([join(repo, 'src', 'tool.mjs')], repo);
  check('the runtime read still runs from the new path', tool.status === 0 && tool.out.trim() === 'tool-table' && read(repo, 'src/tool.mjs').includes(`${HUB}/35 Contracts and Data/Manifests/tools.json`), tool.all);
  manifest = readJson(repo, `${HUB}/98 System/DOCS_MANIFEST.json`);
  check('the manifest marks every legacy root removed and holds no pointer entry',
    WAVES.every((w) => manifest.legacyPaths.some((e) => e.path === w && e.disposition === 'removed')) && manifest.legacyPaths.length === 4);
  forwarding = readJson(repo, `${HUB}/98 System/FORWARDING.json`);
  check('FORWARDING.json holds one entry per collection and one per moved file', forwarding.forwards.length === 2 + 1 + 3 + 1
    && forwarding.forwards.some((f) => f.from === 'docs/audit' && f.to === auditTarget) && forwarding.forwards.some((f) => f.from === 'legacy/old.md' && f.to === `${HUB}/99 Archive/Specs/old.md`));
  check('history keeps its old paths after every wave', [...before].every(([p, text]) => read(repo, p) === text) && /legacy\/findings-register\.md/.test(read(repo, 'runs/programs/alpha/PROGRAM.md')));
  check('both collections pass check and strict history verification', ['rulings', 'audit'].every((id) => records(id, 'check').status === 0 && records(id, 'verify-history', '--strict').status === 0));

  // ---- generated register ----
  const rendered = records('rulings', 'render', '--register');
  const registerText = existsSync(join(repo, HUB, '20 Decisions', 'REGISTER.md')) ? read(repo, `${HUB}/20 Decisions/REGISTER.md`) : '';
  const vault = node([join(SCRIPTS, 'check-vault-standard.mjs'), join(repo, HUB)], repo);
  check('the rendered register carries frontmatter and the vault standard covers it and the frontmatter-free audit records',
    rendered.status === 0 && /^---\ntype: register\nstatus: current\nupdated: \d{4}-\d{2}-\d{2}\n---\n/.test(registerText) && vault.status === 0, rendered.all + vault.all);

  // ---- gate step 6 ----
  let g = gate();
  check('the gate passes after the waves and names step 6 as run', g.status === 0 && /docs gate: PASS/.test(g.out) && /^ {2}6 legacy-path guards: ok \(\d+ relocated path/m.test(g.out), g.all);
  put(repo, 'README.md', `${read(repo, 'README.md')}\nAlso docs/audit/a1.md.\n`);
  g = gate();
  check('the gate fails when a tracked file references a relocated path', g.status === 1 && /step 6: README\.md references relocated path docs\/audit/.test(g.err), g.all);
  check('a reference inside PROGRAM.md, HANDOFF.md, and FORWARDING.json does not fail step 6', !/step 6: (runs\/|project-docs\/98)/.test(g.err));
  const key = /step 6: (README\.md references relocated path docs\/audit)/.exec(g.err)?.[1];
  g = gate(['--baseline-init']);
  const baseline = existsSync(join(repo, HUB, '98 System', 'GATE_BASELINE.jsonl')) ? read(repo, `${HUB}/98 System/GATE_BASELINE.jsonl`) : '';
  check('the step 6 key is stable and holds no line number', g.status === 0 && baseline === `${JSON.stringify({ step: 6, key })}\n`, baseline);
  put(repo, 'README.md', `${read(repo, 'README.md')}\nAnd again docs/audit/sub/a2.md on a new line.\n`);
  g = gate(['--check']);
  check('the same violation on a new line stays baselined', g.status === 0 && /1 baselined/.test(g.out), g.all);
  git(repo, 'checkout', '--', 'README.md');
  rmSync(join(repo, HUB, '98 System', 'GATE_BASELINE.jsonl'));

  // ---- forward ----
  const fwd = join(work, 'fwd-repo');
  cpSync(repo, fwd, { recursive: true });
  git(fwd, 'checkout', '-q', '-b', 'feat');
  put(fwd, 'docs/audit/a3.md', '# Audit 3\n');
  put(fwd, 'legacy/new.md', spec('New spec', 'current', 'It names docs/audit/a1.md.'));
  put(fwd, 'src/other.mjs', "export const a = 'docs/audit/a1.md';\n");
  put(fwd, 'notes/ref.md', 'Old ruling: docs/rulings/r2.md and unrelated docs/other/x.md.\n');
  commit(fwd, 'branch work cut before the waves');
  const fwdBase = branchName;
  const noPlan = node([RELOCATE, 'forward', '--root', fwd, '--base', fwdBase], fwd);
  check('forward with a file that has no route exits 1, names the file, and moves nothing',
    noPlan.status === 1 && /no route for legacy\/new\.md/.test(noPlan.err) && existsSync(join(fwd, 'legacy/new.md')) && existsSync(join(fwd, 'docs/audit/a3.md')), noPlan.all);
  const forwarded = node([RELOCATE, 'forward', '--root', fwd, '--base', fwdBase, '--plan', planFile], fwd);
  check('forward moves a file added under a collection root through FORWARDING.json', forwarded.status === 0 && existsSync(join(fwd, auditTarget, 'a3.md')) && !existsSync(join(fwd, 'docs/audit/a3.md')), forwarded.all);
  check('forward moves a file added under a tree root through the plan routing', existsSync(join(fwd, HUB, '10 Design/Specs/new.md')) && !existsSync(join(fwd, 'legacy/new.md')));
  check('forward rewrites the branch references through FORWARDING.json and leaves unrelated paths',
    read(fwd, 'src/other.mjs').includes(`${auditTarget}/a1.md`) && read(fwd, 'notes/ref.md').includes(`${rulingsTarget}/r2.md`) && read(fwd, 'notes/ref.md').includes('docs/other/x.md')
    && read(fwd, `${HUB}/10 Design/Specs/new.md`).includes(`${auditTarget}/a1.md`));
  check('forward leaves PROGRAM.md byte-identical', read(fwd, 'runs/programs/alpha/PROGRAM.md') === before.get('runs/programs/alpha/PROGRAM.md'));
  const again = node([RELOCATE, 'forward', '--root', fwd, '--base', fwdBase, '--plan', planFile], fwd);
  check('forward is idempotent', again.status === 0 && /moved 0 file/.test(again.out) && /rewrote 0 reference/.test(again.out), again.all);

  // ---- facade and integrate-branch ----
  const facade = node([join(SCRIPTS, 'co.mjs'), 'docs', 'relocate', 'plan', '--root', join(work, 'pass-repo'), '--run', join(work, 'facade-run'), '--legacy', 'legacy'], ROOT);
  check('co docs relocate reaches the script', facade.status === 0 && /relocate plan: 1 file\(s\), 1 wave\(s\)/.test(facade.out) && existsSync(join(work, 'facade-run', 'RELOCATION_PLAN.json')), facade.all);
  const integrate = await import(pathToFileURL(join(SCRIPTS, 'integrate-branch.mjs')).href);
  check('the integrate-branch forward step applies after a wave', integrate.relocateForwardApplies(repo) === true);
  check('the integrate-branch forward step does not apply before a wave', integrate.relocateForwardApplies(join(work, 'pass-repo')) === false);
  check('the integrate-branch forward step does not apply to this repository', integrate.relocateForwardApplies(ROOT) === false);
} catch (error) {
  check('eval ran to completion', false, error.stack);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} docs relocate check(s) failed:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: docs relocate regression eval passed.');

// The stub runs need a repository that only has to exist and match the real one's shape, so a stub
// suite skips adoption. `git rev-parse HEAD` and the tracked files are all the shared cases read.
function buildStubRepo(name) {
  const repo = join(work, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '-b', 'main');
  put(repo, 'docs/rulings/r1.md', '# Ruling 1\n');
  put(repo, 'legacy/plan.md', spec('Plan', 'current'));
  put(repo, `${HUB}/98 System/DOCS_MANIFEST.json`, '{"version":3}\n');
  commit(repo, 'seed');
  return repo;
}
