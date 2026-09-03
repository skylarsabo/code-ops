#!/usr/bin/env node
// opencode distribution regression eval — validates the generated package's discovery
// surface, name-collision handling, permission translation, tier bindings, and the ported
// traceless plugin's actual blocking behavior.
//
//   node evals/opencode-dist/run.mjs   (exit 0 = pass)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLAUDE_ALIAS_TIER, DEFAULT_PROVIDER, PROVIDER_TIERS, TIER_ORDER, leadInherits } from '../../scripts/model-tiers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const dist = join(root, 'opencode-dist');
const sourcePluginsDir = join(root, 'plugins');
const pluginNames = ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'];
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const fails = [];
const expect = (condition, message) => { if (!condition) fails.push(message); };

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
    expectedAgents.push({ name: `${plugin}-${name}`, tier: CLAUDE_ALIAS_TIER[alias], alias, sourcePath });
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
  expect(text.includes('opencode path rule:'), `${name}: missing the plugin-root resolution rule`);

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
}

// ---- 4. tier bindings are complete and every agent is bound --------------------
const tiers = read(join(dist, 'MODEL_TIERS.md'));
for (const provider of Object.values(PROVIDER_TIERS)) {
  for (const tier of TIER_ORDER) {
    if (provider.models[tier] === null) { expect(tiers.includes('session model (lead unset)'), `MODEL_TIERS.md must say the ${provider.id} lead is unset`); continue; }
    expect(tiers.includes(`\`${provider.id}/${provider.models[tier]}\``), `MODEL_TIERS.md is missing the ${provider.id} binding for ${tier}`);
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

// ---- 5. the ported traceless plugin actually blocks -----------------------------
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
};
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
}

// ---- 6. the registry checker holds the table it validates ----------------------
// Offline shape mode only. The --fetch mode resolves ids against models.dev and is opt-in
// by design, so an eval must never invoke it: a third-party outage would fail this repo.
const registryCheck = spawnSync(process.execPath, [join(root, 'scripts', 'check-model-registry.mjs')], { encoding: 'utf8' });
expect(registryCheck.status === 0, `check-model-registry.mjs (offline) should pass, got ${registryCheck.status}: ${(registryCheck.stderr || '').trim()}`);
expect(/every tier pinned/.test(registryCheck.stdout), 'check-model-registry.mjs did not confirm every tier is pinned');

// ---- 7. the renderer is wired where drift would otherwise go unnoticed ----------
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
console.log(`PASS — opencode distribution: ${renderedSkills.length} skills, ${expectedAgents.length} agents, prefix collisions resolved, permissions and tiers translated, ported traceless gate blocks.`);
