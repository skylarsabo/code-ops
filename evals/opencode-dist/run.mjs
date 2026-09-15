#!/usr/bin/env node
// opencode distribution regression eval — validates the generated package's discovery
// surface, name-collision handling, permission translation, tier bindings, and the ported
// traceless plugin's actual blocking behavior.
//
//   node evals/opencode-dist/run.mjs   (exit 0 = pass)

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COMMAND_CASES } from '../ai-tells/command-cases.mjs';
import { CLAUDE_ALIAS_TIER, DEFAULT_PROVIDER, PROVIDER_SPECIALISTS, PROVIDER_TIERS, TIER_ORDER, leadInherits } from '../../scripts/model-tiers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
// Render into a disposable in-repository directory. This tests the complete current renderer
// while leaving the tracked opencode-dist/ artifact untouched; the normal drift check owns
// that artifact separately.
const dist = mkdtempSync(join(here, '.render-'));
process.on('exit', () => { try { rmSync(dist, { recursive: true, force: true }); } catch { /* best effort */ } });
const render = spawnSync(process.execPath, [join(root, 'scripts', 'build-opencode-dist.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, CODE_OPS_OPENCODE_OUTPUT_ROOT: dist },
});
if (render.status !== 0) {
  throw new Error(`opencode renderer failed in the disposable eval output: ${(render.stderr || render.stdout || '').trim()}`);
}
const renderedCheck = spawnSync(process.execPath, [join(root, 'scripts', 'build-opencode-dist.mjs'), '--check'], {
  encoding: 'utf8',
  env: { ...process.env, CODE_OPS_OPENCODE_OUTPUT_ROOT: dist },
});
if (renderedCheck.status !== 0) {
  throw new Error(`disposable opencode distribution drifted immediately after rendering: ${(renderedCheck.stderr || renderedCheck.stdout || '').trim()}`);
}
const unsafeRender = spawnSync(process.execPath, [join(root, 'scripts', 'build-opencode-dist.mjs')], {
  encoding: 'utf8', env: { ...process.env, CODE_OPS_OPENCODE_OUTPUT_ROOT: root },
});
if (unsafeRender.status === 0 || !/must be a \.render-\*/.test(`${unsafeRender.stderr}${unsafeRender.stdout}`)) {
  throw new Error('opencode renderer accepted a destructive output override outside its eval scratch root');
}
const sourcePluginsDir = join(root, 'plugins');
const pluginNames = ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'];
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const fails = [];
const expect = (condition, message) => { if (!condition) fails.push(message); };

expect(PROVIDER_TIERS.anthropic.models.frontier === 'claude-fable-5-1', 'Anthropic frontier must bind to Fable 5.1');

// opencode's own name grammar; a name that fails it is silently undiscoverable.
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---- 1. every canonical skill has a prefixed, discoverable counterpart ----------
const expectedSkills = [];
const expectedAgents = [];
for (const plugin of pluginNames) {
  for (const entry of readdirSync(join(sourcePluginsDir, plugin, 'skills'), { withFileTypes: true })) {
    if (entry.isDirectory()) expectedSkills.push(`${plugin}-${entry.name}`);
  }
  const agentsDir = join(sourcePluginsDir, plugin, 'agents');
  if (!existsSync(agentsDir)) continue;
  for (const file of readdirSync(agentsDir)) {
    if (!file.endsWith('.md')) continue;
    const sourcePath = join(agentsDir, file);
    const header = read(sourcePath).match(/^---\n([\s\S]*?)\n---/)[1];
    const name = header.match(/^name:[ \t]*(\S+)/m)[1];
    const alias = header.match(/^model:[ \t]*(\S+)/m)[1];
    // Keep the source path rather than reconstructing it: agent names contain hyphens
    // (`privacy-reviewer`), so splitting the prefixed name back apart is ambiguous.
    expectedAgents.push({ name: `${plugin}-${name}`, sourceName: name, tier: CLAUDE_ALIAS_TIER[alias], alias, sourcePath });
  }
}
expectedSkills.sort();
expectedAgents.sort((a, b) => a.name.localeCompare(b.name));

const renderedSkills = readdirSync(join(dist, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
expect(JSON.stringify(renderedSkills) === JSON.stringify(expectedSkills), 'generated skills do not match the canonical source set');

// The collision guard is the whole reason for the prefix: `full-sweep` ships in two
// plugins and `explorer` in two more. A renderer that dropped the prefix would silently
// render 59 skills here instead of 61, so assert the count as well as the names.
expect(new Set(renderedSkills).size === expectedSkills.length, 'generated skill names collide after prefixing');
expect(renderedSkills.filter((n) => n.endsWith('-full-sweep')).length === 2, 'the two full-sweep skills did not both survive prefixing');
expect(expectedAgents.filter((a) => a.name.endsWith('-explorer')).length === 2, 'fixture drift: the two explorer agents are no longer both present');

// ---- 2. skills are host-clean and paired with a command ------------------------
for (const name of renderedSkills) {
  const text = read(join(dist, 'skills', name, 'SKILL.md'));
  expect(NAME_RE.test(name) && name.length <= 64, `${name}: not a legal opencode skill name`);
  expect(text.startsWith(`---\nname: ${name}\n`), `${name}: SKILL.md does not declare its opencode name`);
  expect(!text.includes('${CLAUDE_PLUGIN_ROOT}'), `${name}: Claude plugin-root token leaked`);
  expect(!/`\/[a-z-]+:[a-z-]+`/.test(text), `${name}: Claude colon-spelled slash command leaked`);
  expect(!/\b(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):[a-z0-9-]+\b/.test(text), `${name}: bare Claude skill reference leaked`);
  expect(text.includes('opencode path rule:'), `${name}: missing the plugin-root resolution rule`);
  expect(text.includes('**OpenCode runtime note:**'), `${name}: does not classify unsupported canonical hooks`);

  const commandPath = join(dist, 'commands', `${name}.md`);
  expect(existsSync(commandPath), `${name}: no matching slash command was generated`);
  if (existsSync(commandPath)) {
    const command = read(commandPath);
    expect(command.includes(`\`${name}\` skill`), `${name}: command does not name its skill`);
    expect(command.includes('$ARGUMENTS'), `${name}: command drops caller arguments`);
  }
}

// ---- 3. agents translate the Claude tool allowlist into opencode permissions ----
for (const agent of expectedAgents) {
  const path = join(dist, 'agents', `${agent.name}.md`);
  expect(existsSync(path), `${agent.name}: agent was not rendered`);
  if (!existsSync(path)) continue;
  const text = read(path);
  expect(text.includes('mode: subagent'), `${agent.name}: not declared as an opencode subagent`);
  expect(!/^tools:/m.test(text), `${agent.name}: Claude-only tools frontmatter leaked`);
  expect(!/^model:/m.test(text), `${agent.name}: Claude-only model alias leaked`);
  expect(text.includes(`Required capability tier: \`${agent.tier}\``), `${agent.name}: does not carry its capability tier`);

  // The read-only operatives are the ones a permission mistranslation would quietly arm.
  const sourceTools = read(agent.sourcePath).match(/^tools:[ \t]*(.+)$/m)[1];
  const canEdit = /\b(Write|Edit)\b/.test(sourceTools);
  const canRunShell = /\bBash\b/.test(sourceTools);
  expect(text.includes(`edit: ${canEdit ? 'allow' : 'deny'}`), `${agent.name}: edit permission does not match its source tool allowlist`);
  expect(text.includes(`bash: ${canRunShell ? 'allow' : 'deny'}`), `${agent.name}: bash permission does not match its source tool allowlist`);

  // Agent names can contain hyphens, so derive the carrier from the source path instead of
  // splitting the rendered name. It is deliberately outside top-level agents/ discovery.
  const sourcePlugin = agent.sourcePath.split(/[\\/]/).at(-3);
  const carrier = join(dist, 'code-ops', sourcePlugin, 'agents', agent.sourcePath.split(/[\\/]/).at(-1));
  expect(existsSync(carrier), `${agent.name}: vendored preflight floor carrier is missing`);
  if (existsSync(carrier)) {
    const floor = read(carrier);
    expect(floor.includes(`name: ${agent.sourceName}`), `${agent.name}: floor carrier has the wrong source name`);
    expect(floor.includes(`model: ${agent.alias}`), `${agent.name}: floor carrier has the wrong source model alias`);
  }
}

// The canonical preflight is vendored unchanged. Its existing report must now see the carrier
// rather than printing that floors are unknown in the rendered layout.
const preflight = spawnSync(process.execPath, [join(dist, 'code-ops', 'code-ops-suite', 'scripts', 'preflight.mjs')], { encoding: 'utf8' });
expect(preflight.status === 0, `rendered preflight should pass, got ${preflight.status}: ${(preflight.stderr || '').trim()}`);
expect(!preflight.stdout.includes('floors unknown here'), 'rendered preflight cannot see its agent-floor carriers');
expect(preflight.stdout.includes('code-ops-suite/explorer'), 'rendered preflight does not report code-ops-suite agent floors');
expect(preflight.stdout.includes('strong') && !/\b(?:opus|sonnet|haiku)\b/.test(preflight.stdout), 'rendered preflight reports Claude aliases instead of portable tiers');

// ---- 4. tier bindings are complete and every agent is bound --------------------
const tiers = read(join(dist, 'MODEL_TIERS.md'));
for (const provider of Object.values(PROVIDER_TIERS)) {
  for (const tier of TIER_ORDER) {
    if (provider.models[tier] === null) { expect(tiers.includes('session model (lead unset)'), `MODEL_TIERS.md must say the ${provider.id} lead is unset`); continue; }
    expect(tiers.includes(`\`${provider.id}/${provider.models[tier]}\``), `MODEL_TIERS.md is missing the ${provider.id} binding for ${tier}`);
  }
}
// Version 4 run contracts need a frontier lead, which the default ladder does not bind, and
// they take bare ids. An operator following only the generated docs must learn both rules.
{
  const fallback = PROVIDER_TIERS[DEFAULT_PROVIDER];
  const strong = fallback.models.strong;
  const section = tiers.split('## Run contracts')[1]?.split('\n## ')[0] ?? '';
  expect(section.length > 0, 'MODEL_TIERS.md is missing the Run contracts section');
  expect(section.includes('requires a `frontier` lead in every version 4 `RUN_CONTRACT.json`'), 'MODEL_TIERS.md does not state the version 4 frontier-lead requirement');
  expect(section.includes('A `calibration` block is the only exception') && section.includes(`\`${strong}\``), 'MODEL_TIERS.md does not describe the calibration-block exception');
  expect(section.includes('rejects') && section.includes('also serves the `frontier` rung'), 'MODEL_TIERS.md does not state the calibration rejection where strong equals frontier');
  for (const provider of Object.values(PROVIDER_TIERS)) {
    const collapsed = provider.models.strong !== null && provider.models.strong === provider.models.frontier;
    if (collapsed) expect(section.includes(provider.label), `MODEL_TIERS.md does not list ${provider.id} among ladders that cannot run a calibration strong lead`);
  }
  expect(section.includes(`Write \`${strong}\`, not \`${fallback.id}/${strong}\``), 'MODEL_TIERS.md does not state the bare model id rule for contracts');
}
for (const [providerId, specialists] of Object.entries(PROVIDER_SPECIALISTS)) {
  for (const specialist of specialists) {
    expect(tiers.includes(`\`${providerId}/${specialist.model}\``), `MODEL_TIERS.md is missing the ${providerId}/${specialist.name} specialist`);
  }
}
// Every provider must be independently usable, or "portable across providers" is a claim
// the package does not back. A reader on any listed provider needs a config they can copy
// with every agent already bound to a model that meets its floor.
for (const provider of Object.values(PROVIDER_TIERS)) {
  const path = join(dist, 'configs', `opencode.${provider.id}.json`);
  expect(existsSync(path), `configs/opencode.${provider.id}.json is missing`);
  if (!existsSync(path)) continue;
  const perProvider = JSON.parse(read(path));
  if (leadInherits(provider)) expect(!Object.hasOwn(perProvider, 'model'), `${provider.id}: inherited lead must stay unset`);
  else expect(perProvider.model === `${provider.id}/${provider.models.frontier}`, `${provider.id}: lead does not use its default frontier binding`);
  for (const agent of expectedAgents) {
    const bound = perProvider.agent?.[agent.name]?.model;
    expect(bound === `${provider.id}/${provider.models[agent.tier]}`, `${provider.id}: binds ${agent.name} to "${bound}", not its ${agent.tier}-tier model`);
  }
}
// The root config is the default provider's copy, so a drifted default is a real regression.
const config = JSON.parse(read(join(dist, 'opencode.json')));
const defaults = PROVIDER_TIERS[DEFAULT_PROVIDER];
if (leadInherits(defaults)) expect(!Object.hasOwn(config, 'model'), 'the default config must carry no top-level model, so the lead inherits the session model');
else expect(config.model === `${defaults.id}/${defaults.models.frontier}`, 'the default config pins the lead to the frontier rung');
expect(config.permission?.bash?.['git push *'] === 'ask' && config.permission?.bash?.['gh pr *'] === 'ask', 'the default config keeps the publish-command ask rules');
for (const agent of expectedAgents) {
  const bound = config.agent?.[agent.name]?.model;
  expect(bound === `${defaults.id}/${defaults.models[agent.tier]}`, `opencode.json binds ${agent.name} to "${bound}", not its ${agent.tier}-tier ${DEFAULT_PROVIDER} model`);
}

// ---- 5. model floors and compaction preservation use verified plugin hooks -------
const floorPluginPath = join(dist, 'plugins', 'code-ops-model-floors.js');
expect(existsSync(floorPluginPath), 'the model-floor plugin was not rendered');
const floorPluginText = readFileSync(floorPluginPath, 'utf8');
expect(floorPluginText.includes('/privacy-opsec-suite-full-sweep'), 'the routing card does not name a valid OpenCode privacy workflow');
expect(!floorPluginText.includes('/privacy-opsec-suite skills'), 'the routing card retains an invalid generic privacy route');
expect(existsSync(join(dist, 'code-ops', 'code-ops-suite', 'hooks', 'digest-rewrite.mjs')), 'the canonical digest adapter hook was not rendered');
const strongAgent = expectedAgents.find((agent) => agent.tier === 'strong');
const anthropic = PROVIDER_TIERS.anthropic;
if (!strongAgent || anthropic.models.light === null || anthropic.models.strong === null) {
  fails.push('fixture drift: need an Anthropic strong agent and distinct model rungs for the floor probe');
} else {
  const indexDir = join(dist, '.index-probe');
  const floorProbe = `
import { CodeOpsModelFloors } from ${JSON.stringify(pathToFileURL(floorPluginPath).href)};
import { existsSync } from 'node:fs';
const hooks = await CodeOpsModelFloors({ directory: ${JSON.stringify(root)} });
const run = async (model) => {
  try {
    await hooks['chat.params']({ agent: ${JSON.stringify(strongAgent.name)}, model }, {});
    return 'allowed';
  } catch { return 'blocked'; }
};
const compaction = { context: [] };
await hooks['experimental.session.compacting']({}, compaction);
const system = { system: [] };
await hooks['experimental.chat.system.transform']({}, system);
const digest = { args: { command: 'git diff --stat' } };
await hooks['tool.execute.before']({ tool: 'bash' }, digest);
await hooks.event({ event: { type: 'file.edited', properties: { file: ${JSON.stringify(join(root, 'scripts', 'co.mjs'))} } } });
const config = {};
await hooks.config(config);
console.log(JSON.stringify({
  belowFloor: await run({ providerID: 'anthropic', id: ${JSON.stringify(anthropic.models.light)} }),
  atFloor: await run({ providerID: 'anthropic', id: ${JSON.stringify(anthropic.models.strong)} }),
  unknown: await run({ providerID: 'unknown', id: 'unknown' }),
  preserved: compaction.context.some((line) => line.includes('Compaction summary:')),
  routed: system.system.some((line) => line.includes('code-ops standard operating mode')),
  digested: digest.args.command.includes('digest.mjs'),
  indexed: existsSync(${JSON.stringify(indexDir)}),
  mcp: Object.keys(config.mcp ?? {}).sort(),
}));
`;
  const floorResult = spawnSync(process.execPath, ['--input-type=module', '-e', floorProbe], { encoding: 'utf8', env: { ...process.env, CODE_OPS_DIGEST: 'on', CODE_OPS_INDEX_DIR: indexDir } });
  if (floorResult.status !== 0) {
    fails.push(`model-floor plugin probe failed to run: ${(floorResult.stderr || '').trim().split('\n').slice(-3).join(' ')}`);
  } else {
    const verdicts = JSON.parse(floorResult.stdout.trim().split('\n').pop());
    expect(verdicts.belowFloor === 'blocked', `model-floor plugin should block a below-floor binding, got ${verdicts.belowFloor}`);
    expect(verdicts.atFloor === 'allowed', `model-floor plugin should allow an at-floor binding, got ${verdicts.atFloor}`);
    expect(verdicts.unknown === 'blocked', `model-floor plugin should block an unclassified binding, got ${verdicts.unknown}`);
    expect(verdicts.preserved === true, 'model-floor plugin did not append compaction preservation context');
    expect(verdicts.routed === true, 'OpenCode runtime plugin did not inject routing guidance');
    expect(verdicts.digested === true, 'OpenCode runtime plugin did not apply the canonical digest rewrite');
    expect(verdicts.indexed === true, 'OpenCode runtime plugin did not refresh the edited-file index');
    expect(JSON.stringify(verdicts.mcp) === JSON.stringify(['code-ops-docs', 'code-ops-query']), `OpenCode runtime plugin did not auto-configure both MCP servers: ${JSON.stringify(verdicts.mcp)}`);
  }
}

const conventions = read(join(dist, 'code-ops', 'code-ops-suite', 'CONVENTIONS.md'));
expect(conventions.includes('**OpenCode runtime limits.**'), 'OpenCode conventions do not classify unavailable hook mechanics');
expect(!conventions.includes('Four mechanisms ship with this plugin and are on by default'), 'OpenCode conventions still claim unavailable hooks run by default');
expect(conventions.includes('`CODE_OPS_DIGEST` and `CODE_OPS_INDEX` are process-environment switches'), 'OpenCode conventions do not identify the actual switch location');
for (const plugin of ['privacy-opsec-suite', 'researcher', 'rigor']) {
  const sibling = read(join(dist, 'code-ops', plugin, 'CONVENTIONS.md'));
  expect(sibling.includes('**OpenCode sibling runtime.**'), `${plugin} conventions retain the Claude sibling-runtime claim`);
  expect(sibling.includes('routing and compaction have no off switch'), `${plugin} conventions overstate OpenCode runtime switches`);
  expect(sibling.includes('no operative ladder card or session receipt'), `${plugin} conventions claim unavailable OpenCode lifecycle hooks`);
  expect(!sibling.includes('.claude/settings.json'), `${plugin} conventions retain the Claude settings location`);
}
// Skills cite vendored execution specs at <plugin-root>/reference/, which resolves to
// code-ops/<plugin>/reference/. Only lines naming a host-specific token may differ from canonical.
const HOST_SPECIFIC_LINE = /\$\{CLAUDE_PLUGIN_ROOT\}|CLAUDE\.md|Claude Code|(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):/;
const referenceSpecs = [];
for (const plugin of pluginNames) {
  const sourceReference = join(sourcePluginsDir, plugin, 'reference');
  const renderedReference = join(dist, 'code-ops', plugin, 'reference');
  const specs = existsSync(sourceReference) ? readdirSync(sourceReference).filter((file) => file.endsWith('.md')).sort() : [];
  const rendered = existsSync(renderedReference) ? readdirSync(renderedReference).filter((file) => file.endsWith('.md')).sort() : [];
  expect(JSON.stringify(rendered) === JSON.stringify(specs), `${plugin}: rendered reference specs [${rendered.join(', ')}] do not match canonical [${specs.join(', ')}]`);
  for (const spec of specs.filter((file) => rendered.includes(file))) {
    const source = read(join(sourceReference, spec)).split('\n');
    const text = read(join(renderedReference, spec));
    referenceSpecs.push({ plugin, spec, path: join(renderedReference, spec), text });
    expect(!text.includes('${CLAUDE_PLUGIN_ROOT}'), `${plugin}/reference/${spec}: Claude plugin-root token leaked`);
    if (source.some((line) => line.includes('${CLAUDE_PLUGIN_ROOT}'))) expect(text.includes('<plugin-root>'), `${plugin}/reference/${spec}: plugin-root token was dropped rather than translated`);
    expect(!/\b(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):[a-z0-9-]+\b/.test(text), `${plugin}/reference/${spec}: bare Claude skill reference leaked`);
    const lines = text.split('\n');
    expect(lines.length === source.length, `${plugin}/reference/${spec}: line count diverged from canonical`);
    const drifted = source.findIndex((line, index) => !HOST_SPECIFIC_LINE.test(line) && lines[index] !== line);
    expect(drifted === -1, `${plugin}/reference/${spec}: line ${drifted + 1} diverged from canonical without a host token`);
  }
}
expect(referenceSpecs.length > 0, 'fixture drift: no canonical reference specs exist to project');
// Negative direction: a projection missing one reference spec must fail the drift check.
if (referenceSpecs.length > 0) {
  const { plugin, spec, path, text } = referenceSpecs[0];
  unlinkSync(path);
  const missingCheck = spawnSync(process.execPath, [join(root, 'scripts', 'build-opencode-dist.mjs'), '--check'], {
    encoding: 'utf8',
    env: { ...process.env, CODE_OPS_OPENCODE_OUTPUT_ROOT: dist },
  });
  writeFileSync(path, text, 'utf8');
  expect(missingCheck.status === 1 && `${missingCheck.stderr}`.includes(`missing generated file: opencode-dist/code-ops/${plugin}/reference/${spec}`), `--check did not detect a missing code-ops/${plugin}/reference/${spec} (exit ${missingCheck.status})`);
}

const openCodeAdoptGlobal = read(join(dist, 'skills', 'code-ops-suite-adopt-global-standards', 'SKILL.md'));
const openCodeAdoptRepo = read(join(dist, 'skills', 'code-ops-suite-adopt-standards', 'SKILL.md'));
expect(openCodeAdoptGlobal.includes('`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and `~/.codex/AGENTS.md`'), 'OpenCode global-standards render collapsed the three host-specific contract paths');
expect(openCodeAdoptRepo.includes('`CLAUDE.md` and `AGENTS.md`'), 'OpenCode repo-standards render collapsed the accepted two-file parity modes');
const compatibility = read(join(dist, 'PLATFORM_COMPATIBILITY.md'));
expect(compatibility.includes('are auto-configured'), 'OpenCode compatibility notes do not describe MCP auto-configuration');
expect(compatibility.includes('intentionally unavailable here'), 'OpenCode compatibility notes do not classify unsupported hook mechanics');

// ---- 6. the ported traceless plugin actually blocks -----------------------------
// The Claude hook is exercised by evals/codex-marketplace; this port has a different
// contract (throw vs exit 2), so it needs its own behavioral proof rather than a text match.
const pluginPath = join(dist, 'plugins', 'code-ops-traceless.js');
expect(existsSync(pluginPath), 'the traceless plugin was not rendered');
// A bare Windows path is not a legal ESM specifier; the import needs a file:// URL.
const probe = `
import { CodeOpsTraceless } from ${JSON.stringify(pathToFileURL(pluginPath).href)};
const hooks = await CodeOpsTraceless({});
const run = async (command, tool = 'bash') => {
  try { await hooks['tool.execute.before']({ tool }, { args: { command } }); return 'allowed'; }
  catch { return 'blocked'; }
};
const out = {
  traced: await run('git commit -m "Generated with Claude Code"'),
  clean: await run('git commit -m "Wait out a busy git index lock"'),
  ungated: await run('git status --short'),
  otherTool: await run('git commit -m "Generated with Claude Code"', 'read'),
  cases: [],
};
for (const command of ${JSON.stringify(COMMAND_CASES.map((entry) => entry.command))}) out.cases.push(await run(command));
console.log(JSON.stringify(out));
`;
const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
if (result.status !== 0) {
  fails.push(`traceless plugin probe failed to run: ${(result.stderr || '').trim().split('\n').slice(-3).join(' ')}`);
} else {
  const verdicts = JSON.parse(result.stdout.trim().split('\n').pop());
  expect(verdicts.traced === 'blocked', `traceless plugin should block a traced commit, got ${verdicts.traced}`);
  expect(verdicts.clean === 'allowed', `traceless plugin should allow a clean commit, got ${verdicts.clean}`);
  expect(verdicts.ungated === 'allowed', `traceless plugin should ignore a non-publishing command, got ${verdicts.ungated}`);
  expect(verdicts.otherTool === 'allowed', `traceless plugin should only gate the bash tool, got ${verdicts.otherTool}`);
  COMMAND_CASES.forEach(({ name, blocked }, index) => {
    const want = blocked ? 'blocked' : 'allowed';
    expect(verdicts.cases[index] === want, `traceless plugin should have ${want} ${name}, got ${verdicts.cases[index]}`);
  });
}

// ---- 7. the registry checker holds the table it validates ----------------------
// Offline shape mode only. The --fetch mode resolves ids against models.dev and is opt-in
// by design, so an eval must never invoke it: a third-party outage would fail this repo.
const registryCheck = spawnSync(process.execPath, [join(root, 'scripts', 'check-model-registry.mjs')], { encoding: 'utf8' });
expect(registryCheck.status === 0, `check-model-registry.mjs (offline) should pass, got ${registryCheck.status}: ${(registryCheck.stderr || '').trim()}`);
expect(/every tier pinned/.test(registryCheck.stdout), 'check-model-registry.mjs did not confirm every tier is pinned');

// ---- 8. the renderer is wired where drift would otherwise go unnoticed ----------
const preCommit = read(join(root, '.githooks', 'pre-commit'));
expect(preCommit.includes('node scripts/build-opencode-dist.mjs'), 'pre-commit hook does not regenerate the opencode distribution');
expect(preCommit.includes('opencode-dist'), 'pre-commit hook does not stage the opencode distribution');
const validate = read(join(root, '.github', 'workflows', 'validate.yml'));
expect(validate.includes('node scripts/build-opencode-dist.mjs --check'), 'validate.yml does not run the opencode drift check');

if (fails.length) {
  console.error('FAIL — opencode distribution eval:');
  for (const failure of fails) console.error('  x ' + failure);
  process.exit(1);
}
console.log(`PASS — opencode distribution: ${renderedSkills.length} skills, ${expectedAgents.length} agents, prefix collisions resolved, permissions translated, model floors enforced, and supported hooks ported.`);
