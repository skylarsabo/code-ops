#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(root, 'scripts', 'attack-chain-graph.mjs');
const runDir = join(root, 'code-ops-docs', '80 Runs', `attack-chain-eval-${process.pid}`); mkdirSync(runDir, { recursive: true });
const campaignPath = join(runDir, 'ATTACK_CAMPAIGN.json'); const contractPath = join(runDir, 'RUN_CONTRACT.json'); const ledgerPath = join(runDir, 'DISPATCH_LEDGER.md');
const rel = (path) => relative(root, path).replaceAll('\\', '/');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writeArtifact = (name, content) => { const path = join(runDir, name); writeFileSync(path, content); return { path: rel(path), sha256: sha(readFileSync(path)) }; };
const evidenceRef = writeArtifact('DIRECT_EVIDENCE.txt', 'direct source and runtime observations\n');
const executionCommand = 'node test/security-chain.mjs'; const executionResult = { exitCode: 0, impactObserved: true, startPrivilege: 'unauthenticated remote', impact: 'cross-account data access' };
const executionRef = writeArtifact('EXECUTION_RECEIPT.json', `${JSON.stringify({ command: executionCommand, result: executionResult })}\n`);
const capabilitiesPath = join(runDir, 'HOST_CAPABILITIES.json');
writeFileSync(capabilitiesPath, `${JSON.stringify({ version: 1, host: 'eval', provider: 'eval', model: 'gpt-5.6-terra', source: 'host-probe', observedAt: new Date().toISOString(), capabilities: { promptCaching: 'unknown', compaction: 'unknown', contextEditing: 'unknown', hostMemory: 'unknown', taskBudget: 'unknown' } }, null, 2)}\n`);
const snapshotPath = join(runDir, 'CONTEXT_SNAPSHOT.json');
execFileSync(process.execPath, [join(root, 'scripts', 'context-snapshot.mjs'), 'prepare', '--root', root, '--out', snapshotPath, '--cache', join(runDir, 'cache'), '--untracked', 'exclude'], { cwd: root, encoding: 'utf8' });
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')); const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const failures = [];
const check = (name, pass, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); if (!pass) failures.push(`${name}: ${detail}`); };
const run = (mode = 'check', extra = []) => { try { return { status: 0, out: execFileSync(process.execPath, [script, mode, '--campaign', campaignPath, '--contract', contractPath, '--ledger', ledgerPath, '--root', root, ...extra], { cwd: root, encoding: 'utf8' }) }; } catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; } };
const save = (value) => writeFileSync(campaignPath, `${JSON.stringify(value, null, 2)}\n`);
const reference = () => structuredClone(evidenceRef);
const evidence = (source = 'source') => [{ source, reference: reference() }];
const work = (unit, actor, wave = 1) => ({ unit, actor, wave });
const unit = (id, wave, role, kind, validates = []) => ({ id, phase: wave === 1 ? 'discover' : 'validate', wave, lens: role, mode: 'read', role, kind, model: 'gpt-5.6-terra', tier: 'strong', effort: kind === 'judgment' ? 'medium' : 'high', brief: `${kind} security chain`, scope: [id === 'D-001' ? 'scripts' : id === 'D-002' ? 'plugins' : id === 'D-003' ? 'evals' : 'code-ops-docs'], artifact: `${rel(runDir)}/${id}.md`, dependsOn: validates, qualityCriteria: ['Q-001'], validates, independentOf: validates });
const units = [unit('D-001', 1, 'family-explorer', 'judgment'), unit('D-002', 1, 'family-explorer', 'judgment'), unit('D-003', 2, 'validator', 'refutation', ['D-001']), unit('D-004', 2, 'validator', 'review', ['D-002'])];
const unitArtifacts = units.map((item) => ({ unit: item.id, reference: writeArtifact(`${item.id}.md`, `reported artifact ${item.id}\n`) }));
writeFileSync(ledgerPath, `| id | role | brief | expected artifact | status |\n| --- | --- | --- | --- | --- |\n${units.map((item) => `| ${item.id} | ${item.role}@${item.model} | ${item.brief} | ${item.artifact} | reported |`).join('\n')}\n`);
const journal = [
  { op: 'add', id: 'D-001', status: 'dispatched', runId: 'attack-chain-eval', actorId: 'actor-input' }, { op: 'add', id: 'D-002', status: 'dispatched', runId: 'attack-chain-eval', actorId: 'actor-auth' },
  { op: 'update', id: 'D-001', to: 'reported', actorId: 'actor-input' }, { op: 'update', id: 'D-002', to: 'reported', actorId: 'actor-auth' },
  { op: 'add', id: 'D-003', status: 'dispatched', runId: 'attack-chain-eval', actorId: 'actor-input-validator' }, { op: 'update', id: 'D-003', to: 'reported', actorId: 'actor-input-validator' },
  { op: 'add', id: 'D-004', status: 'dispatched', runId: 'attack-chain-eval', actorId: 'actor-auth-validator' }, { op: 'update', id: 'D-004', to: 'reported', actorId: 'actor-auth-validator' },
];
const journalText = `${journal.map((item) => JSON.stringify(item)).join('\n')}\n`;
writeFileSync(`${ledgerPath}.journal.jsonl`, journalText);
const runEvidence = () => ({ ledger: { path: rel(ledgerPath), sha256: sha(readFileSync(ledgerPath)) }, journal: { path: rel(`${ledgerPath}.journal.jsonl`), sha256: sha(readFileSync(`${ledgerPath}.journal.jsonl`)) }, artifacts: structuredClone(unitArtifacts) });
const contract = () => ({
  version: 4, revision: 1, runId: 'attack-chain-eval', head, objective: 'Validate defensive attack campaign graphs.', nonGoals: ['No weaponized exploitation.'],
  lead: { model: 'gpt-5.6-sol', tier: 'frontier', effort: 'high' },
  quality: { dimensions: ['security'], criteria: [{ id: 'Q-001', dimension: 'security', description: 'Campaign evidence checks.', oracle: 'command', proof: 'focused eval', blocking: true, owner: 'tool' }] },
  budget: { maxDispatches: 4, maxParallel: 2, maxRetriesPerUnit: 1 }, sharedContext: ['AGENTS.md'], replanOn: ['scope-change', 'new-dependency', 'failed-dispatch', 'quality-gate-failure', 'context-drift', 'runtime-drift'],
  context: { snapshot: 'CONTEXT_SNAPSHOT.json', snapshotId: snapshot.snapshotId, bundleDir: 'bundles', untrackedPolicy: 'exclude', maxBundleBytes: 1000000, maxAtlasExcerptBytes: 100000 },
  runtime: { capabilities: rel(capabilitiesPath), receipts: `${rel(runDir)}/RUNTIME_RECEIPTS.jsonl`, stablePrefix: ['AGENTS.md'], maxStablePrefixBytes: 100000, policy: { promptCaching: 'off', compaction: 'off', contextEditing: 'off', hostMemory: 'off', taskBudget: 'off' } },
  orchestration: { mode: 'lead-and-operatives', minOperatives: 2, minParallel: 2 }, units: structuredClone(units),
});
writeFileSync(contractPath, `${JSON.stringify(contract(), null, 2)}\n`);
const binding = { input: work('D-001', 'family-explorer@gpt-5.6-terra'), auth: work('D-002', 'family-explorer@gpt-5.6-terra') };
const validator = { input: work('D-003', 'validator@gpt-5.6-terra', 2), auth: work('D-004', 'validator@gpt-5.6-terra', 2) };
const node = (prefix, id, kind, label, place) => ({ id: `${prefix}-${id}`, kind, label, location: place });
const inspection = (id, layer, source) => [{ source, reference: writeArtifact(`${id}-${layer}.json`, `${JSON.stringify({ hypothesisId: id, layer })}\n`) }];
const validationReceipt = (id, family, status) => writeArtifact(`${id}-VALIDATION.json`, `${JSON.stringify({ hypothesisId: id, status, validatorUnit: validator[family].unit, validatorActor: validator[family].actor })}\n`);
const chain = (id, family, state = 'OPEN') => ({
  id, family, state, likelihood: 4, impact: 5, implementationDependent: true, work: binding[family],
  nodes: [node(id, 'entry', 'entry', 'public request', `src/${family}.js:1`), node(id, 'guard', 'guard', `${family} gate`, 'src/shared.js:10'), node(id, 'primitive', 'primitive', `${family} parsing boundary`, 'src/shared.js:20'), node(id, 'sink', 'sink', 'account action', 'src/account.js:30')],
  edges: [[`${id}-entry`, `${id}-guard`], [`${id}-guard`, `${id}-primitive`], [`${id}-primitive`, `${id}-sink`]],
  validation: { outOfBand: true, status: state === 'CLOSED' ? 'SURVIVED' : 'PENDING', discoveredBy: binding[family], validator: validator[family], receipt: { reference: validationReceipt(id, family, state === 'CLOSED' ? 'SURVIVED' : 'PENDING'), evidence: evidence('receipt') } },
  directInspection: { runtime: inspection(id, 'runtime', 'runtime'), framework: inspection(id, 'framework', 'framework'), database: inspection(id, 'database', 'database'), library: inspection(id, 'library', 'library'), dependencySource: inspection(id, 'dependencySource', 'dependency-source') },
  ...(state === 'CLOSED' ? { closure: { startPrivilege: 'unauthenticated remote', impact: 'cross-account data access', deployment: { profile: 'common', evidence: evidence('deployment') }, executionReceipt: { reference: structuredClone(executionRef), command: executionCommand, result: executionResult, evidence: evidence('command') } } } : {}),
});
const campaign = () => structuredClone({
  version: 2, mode: 'security', runEvidence: runEvidence(), discoveryEvidence: evidence('source'), goal: { startPrivilege: 'unauthenticated remote', impact: 'cross-account data access', deployment: { profile: 'common', evidence: evidence('configuration') } },
  families: [{ id: 'input', title: 'input handling', owner: binding.input }, { id: 'auth', title: 'authorization', owner: binding.auth }], hypotheses: [chain('H-INPUT-001', 'input'), chain('H-AUTH-001', 'auth', 'CLOSED')],
  launches: [{ id: 'L-INPUT-001', sequence: 1, family: 'input', reason: 'initial', hypothesis: 'H-INPUT-001', work: binding.input }, { id: 'L-AUTH-001', sequence: 2, family: 'auth', reason: 'initial', hypothesis: 'H-AUTH-001', work: binding.auth }],
});

try {
  save(campaign()); let result = run(); check('canonical contract-bound campaign checks', result.status === 0, result.out);
  result = run('check', ['--final']); check('final mode requires and accepts strict all-unit reconciliation', result.status === 0, result.out);
  const partialJournal = journal.slice(0, 4).concat([{ op: 'add', id: 'D-003', status: 'dispatched', runId: 'attack-chain-eval', actorId: 'actor-input-validator' }, { op: 'add', id: 'D-004', status: 'dispatched', runId: 'attack-chain-eval', actorId: 'actor-auth-validator' }]);
  writeFileSync(ledgerPath, `| id | role | brief | expected artifact | status |\n| --- | --- | --- | --- | --- |\n${units.map((item, index) => `| ${item.id} | ${item.role}@${item.model} | ${item.brief} | ${item.artifact} | ${index < 2 ? 'reported' : 'dispatched'} |`).join('\n')}\n`); writeFileSync(`${ledgerPath}.journal.jsonl`, `${partialJournal.map((item) => JSON.stringify(item)).join('\n')}\n`);
  const partial = campaign(); partial.hypotheses[1] = chain('H-AUTH-001', 'auth'); partial.runEvidence = { ledger: { path: rel(ledgerPath), sha256: sha(readFileSync(ledgerPath)) }, journal: { path: rel(`${ledgerPath}.journal.jsonl`), sha256: sha(readFileSync(`${ledgerPath}.journal.jsonl`)) }, artifacts: structuredClone(unitArtifacts.slice(0, 2)) }; save(partial); result = run(); check('in-progress campaign permits dispatched validators without final artifacts', result.status === 0, result.out); result = run('check', ['--final']); check('in-progress campaign cannot claim final closure', result.status !== 0, result.out);
  const fabricatedJournal = partialJournal.filter((event) => event.id !== 'D-004'); const fabricatedLedger = readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter((line) => !/^\| D-004 /.test(line)).join('\n'); writeFileSync(ledgerPath, fabricatedLedger); writeFileSync(`${ledgerPath}.journal.jsonl`, `${fabricatedJournal.map((item) => JSON.stringify(item)).join('\n')}\n`); partial.runEvidence.ledger = { path: rel(ledgerPath), sha256: sha(readFileSync(ledgerPath)) }; partial.runEvidence.journal = { path: rel(`${ledgerPath}.journal.jsonl`), sha256: sha(readFileSync(`${ledgerPath}.journal.jsonl`)) }; save(partial); result = run(); check('fabricated binding without an actual launch fails closed', result.status === 1 && /campaign binding D-004 lacks an actual ledger row/.test(result.out), result.out);
  writeFileSync(ledgerPath, `| id | role | brief | expected artifact | status |\n| --- | --- | --- | --- | --- |\n${units.map((item) => `| ${item.id} | ${item.role}@${item.model} | ${item.brief} | ${item.artifact} | reported |`).join('\n')}\n`); writeFileSync(`${ledgerPath}.journal.jsonl`, journalText); save(campaign());
  const defaultRoot = (() => { try { return { status: 0, out: execFileSync(process.execPath, [script, 'check', '--campaign', campaignPath, '--contract', contractPath, '--ledger', ledgerPath], { cwd: root, encoding: 'utf8' }) }; } catch (error) { return { status: error.status, out: `${error.stdout || ''}${error.stderr || ''}` }; } })();
  check('--root defaults to current working directory', defaultRoot.status === 0, defaultRoot.out);
  const invalidContract = contract(); invalidContract.head = '0'.repeat(40); writeFileSync(contractPath, JSON.stringify(invalidContract)); result = run(); check('canonical run-contract validation rejects stale contract', result.status !== 0 && /head does not match/.test(result.out), result.out); writeFileSync(contractPath, JSON.stringify(contract()));
  writeFileSync(`${ledgerPath}.journal.jsonl`, `${journalText}{bad json}\n`); save(campaign()); result = run(); check('strict reconciliation rejects malformed dispatch journal', result.status !== 0 && /dispatch journal/.test(result.out), result.out); writeFileSync(`${ledgerPath}.journal.jsonl`, journalText);
  for (const [phrase, expected] of [['Git/history', 'git-history'], ['change-log', 'changelog'], ['CVE.database', 'cve-database'], ['patched/version/diff', 'patched-diff']]) {
    const embedded = campaign(); embedded.discoveryEvidence[0].note = `derived from ${phrase}`; save(embedded); result = run(); check(`embedded ${phrase} provenance fails closed`, result.status === 1 && new RegExp(`banned provenance ${expected}`).test(result.out), result.out);
  }
  const serial = campaign(); serial.families[1].owner.wave = 2; serial.hypotheses[1].work.wave = 2; serial.hypotheses[1].validation.discoveredBy.wave = 2; serial.launches[1].work.wave = 2; save(serial); result = run(); check('family units must share a real parallel wave', result.status === 1 && /same parallel wave/.test(result.out), result.out);
  const optionalFlag = campaign(); delete optionalFlag.hypotheses[0].implementationDependent; delete optionalFlag.hypotheses[0].directInspection; save(optionalFlag); result = run(); check('implementation inspection cannot be bypassed by deleting flag', result.status === 1 && /implementationDependent must be true/.test(result.out), result.out);
  const genericInspection = campaign(); const sharedInspection = genericInspection.hypotheses[0].directInspection.runtime[0].reference; for (const layer of ['framework', 'database', 'library', 'dependencySource']) genericInspection.hypotheses[0].directInspection[layer][0].reference = sharedInspection; save(genericInspection); result = run(); check('direct-inspection layers require distinct layer-bound receipts', result.status === 1 && /distinct references/.test(result.out) && /bind hypothesis and layer/.test(result.out), result.out);
  const missing = campaign(); missing.discoveryEvidence[0].reference.path = `${rel(runDir)}/MISSING.txt`; save(missing); result = run(); check('missing evidence reference fails closed', result.status === 1 && /does not exist/.test(result.out), result.out);
  const outside = campaign(); outside.discoveryEvidence[0].reference.path = '../outside.txt'; save(outside); result = run(); check('outside-root evidence reference fails closed', result.status === 1 && /stay inside --root/.test(result.out), result.out);
  const drift = campaign(); drift.discoveryEvidence[0].reference.sha256 = '0'.repeat(64); save(drift); result = run(); check('drifted evidence digest fails closed', result.status === 1 && /sha256 drifted/.test(result.out), result.out);
  const receiptDrift = campaign(); receiptDrift.hypotheses[1].closure.executionReceipt.command = 'different command'; save(receiptDrift); result = run(); check('closure command must match hashed receipt artifact', result.status === 1 && /must match the hashed receipt artifact/.test(result.out), result.out);
  const arbitrarySuccess = campaign(); arbitrarySuccess.hypotheses[1].closure.executionReceipt.result.impactObserved = false; save(arbitrarySuccess); result = run(); check('closure rejects arbitrary non-success result', result.status === 1 && /structured successful result/.test(result.out), result.out);
  const wrongGoal = campaign(); const wrongResult = { exitCode: 0, impactObserved: true, startPrivilege: 'authenticated user', impact: 'local log read' }; wrongGoal.hypotheses[1].closure.executionReceipt.result = wrongResult; wrongGoal.hypotheses[1].closure.executionReceipt.reference = writeArtifact('WRONG_EXECUTION.json', `${JSON.stringify({ command: executionCommand, result: wrongResult })}\n`); save(wrongGoal); result = run(); check('structured execution result must match campaign goal', result.status === 1 && /must match the campaign goal/.test(result.out), result.out);
  const wrongValidator = campaign(); wrongValidator.hypotheses[1].validation.receipt.reference = wrongValidator.hypotheses[0].validation.receipt.reference; save(wrongValidator); result = run(); check('closed validation receipt binds hypothesis status and validator', result.status === 1 && /must bind hypothesis, status, and validator/.test(result.out), result.out);
  const reusedValidator = campaign(); reusedValidator.hypotheses[0] = chain('H-INPUT-001', 'input', 'CLOSED'); reusedValidator.hypotheses[0].validation.receipt.reference = reusedValidator.hypotheses[1].validation.receipt.reference; save(reusedValidator); result = run(); check('closed validation receipt cannot be reused', result.status === 1 && /cannot be reused/.test(result.out), result.out);
  const missingArtifact = campaign(); missingArtifact.runEvidence.artifacts.pop(); save(missingArtifact); result = run(); check('campaign requires every reported unit artifact', result.status === 1 && /reported campaign binding D-004 lacks a hash-bound artifact/.test(result.out), result.out);
  const unreachable = campaign(); unreachable.hypotheses[0].nodes.push(node('H-INPUT-001', 'dead', 'guard', 'dead guard', 'src/dead.js:1')); save(unreachable); result = run(); check('unreachable extra node fails closed', result.status === 1 && /does not participate/.test(result.out), result.out);
  const alternate = campaign(); alternate.hypotheses[0].nodes.push(node('H-INPUT-001', 'alternate', 'guard', 'alternate guard', 'src/alternate.js:1')); alternate.hypotheses[0].edges.push(['H-INPUT-001-entry', 'H-INPUT-001-alternate'], ['H-INPUT-001-alternate', 'H-INPUT-001-primitive']); save(alternate); result = run(); check('alternate entry-to-sink branch participates', result.status === 0, result.out);

  const dominant = campaign(); dominant.hypotheses[1] = chain('H-AUTH-001', 'auth'); dominant.hypotheses.push(chain('H-INPUT-002', 'input'), chain('H-INPUT-003', 'input'), chain('H-AUTH-002', 'auth'));
  dominant.launches.push({ id: 'L-INPUT-002', sequence: 3, family: 'input', reason: 'initial', hypothesis: 'H-INPUT-002', work: binding.input }, { id: 'L-INPUT-003', sequence: 4, family: 'input', reason: 'initial', hypothesis: 'H-INPUT-003', work: binding.input }, { id: 'L-AUTH-002', sequence: 5, family: 'auth', reason: 'neglected', hypothesis: 'H-AUTH-002', work: binding.auth }); save(dominant); result = run();
  check('dominant family cannot deepen before immediate counterlaunch', result.status === 1 && /deepens dominant family/.test(result.out), result.out);
  dominant.hypotheses[2].state = 'BLOCKED'; dominant.hypotheses[2].blockReason = 'later state change'; dominant.hypotheses[3].state = 'BLOCKED'; dominant.hypotheses[3].blockReason = 'later state change'; save(dominant); result = run(); check('later hypothesis states cannot erase dominant launch history', result.status === 1 && /deepens dominant family/.test(result.out), result.out);
  const relaunched = campaign(); relaunched.launches.push({ id: 'L-INPUT-RETRY', sequence: 3, family: 'input', reason: 'initial', hypothesis: 'H-INPUT-001', work: binding.input }); save(relaunched); result = run(); check('one hypothesis cannot be relaunched to fake fan-out', result.status === 1 && /launched more than once/.test(result.out), result.out);
  dominant.hypotheses[2].state = 'OPEN'; delete dominant.hypotheses[2].blockReason; dominant.hypotheses[3].state = 'OPEN'; delete dominant.hypotheses[3].blockReason;
  dominant.hypotheses[1].validation.receipt.reference = validationReceipt('H-AUTH-001', 'auth', 'PENDING');
  dominant.launches[3].sequence = 5; dominant.launches[4].sequence = 4;
  dominant.hypotheses.push(chain('H-AUTH-003', 'auth')); dominant.launches.push({ id: 'L-AUTH-003', sequence: 6, family: 'auth', reason: 'neglected', hypothesis: 'H-AUTH-003', work: binding.auth });
  save(dominant); result = run(); check('each immediate neglected OPEN counterlaunch clears dominance', result.status === 0, result.out);

  const blockedResume = campaign(); blockedResume.hypotheses[1] = chain('H-AUTH-001', 'auth', 'BLOCKED'); blockedResume.hypotheses[1].blockReason = 'guard dominates'; blockedResume.hypotheses[1].nodes.at(-1).location = 'src/input.js:1'; save(blockedResume); result = run('report');
  check('exact blocked terminal can resume at reachable OPEN entry', result.status === 0 && /blocked-to-open resumptions H-AUTH-001->H-INPUT-001/.test(result.out), result.out);
  blockedResume.hypotheses[1].nodes.at(-1).location = 'src/input.js:2'; save(blockedResume); result = run('report'); check('same file but different location is not a resumption', result.status === 0 && !/blocked-to-open resumptions/.test(result.out), result.out);
  blockedResume.hypotheses[1].nodes[1].location = 'src/input.js:1'; blockedResume.hypotheses[1].nodes.at(-1).location = 'src/account.js:30'; save(blockedResume); result = run('report'); check('nonterminal collision cannot create a resumption', result.status === 0 && !/blocked-to-open resumptions/.test(result.out), result.out);

  const duplicateLocation = campaign(); duplicateLocation.hypotheses[0].nodes[2].location = 'src/shared.js:10'; save(duplicateLocation); result = run('report');
  check('ranking counts each cross-chain location once per hypothesis', result.status === 0 && /H-INPUT-001 .*location collisions 2;/.test(result.out), result.out);
  const alternateSyntax = campaign(); alternateSyntax.hypotheses[1].nodes[1].location = 'src/shared.js#L10'; save(alternateSyntax); result = run('report'); check('line-anchor and colon locations canonicalize together', result.status === 0 && /location:src\/shared\.js:10/.test(result.out), result.out);
  const caseVariant = campaign(); caseVariant.hypotheses[1].nodes[1].location = 'SRC/SHARED.JS:10'; save(caseVariant); result = run('report'); const hasCaseCollision = /location:src\/shared\.js:10/.test(result.out); check('location case follows host filesystem semantics', result.status === 0 && hasCaseCollision === (process.platform === 'win32'), result.out);
  const hiddenTail = campaign(); hiddenTail.hypotheses[0].nodes.push(node('H-INPUT-001', 'late-primitive', 'primitive', 'late primitive', 'src/late.js:40'), node('H-INPUT-001', 'late-sink', 'sink', 'late sink', 'src/late.js:50')); hiddenTail.hypotheses[0].edges.push(['H-INPUT-001-sink', 'H-INPUT-001-late-primitive'], ['H-INPUT-001-late-primitive', 'H-INPUT-001-late-sink']); save(hiddenTail); result = run(); check('sink cannot hide a later primitive and sink', result.status === 1 && /sink H-INPUT-001-sink must have outdegree zero/.test(result.out), result.out);
} finally { rmSync(runDir, { recursive: true, force: true }); }

if (failures.length) { console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`); process.exit(1); }
console.log('\nattack-chain-graph eval passed');
