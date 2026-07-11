#!/usr/bin/env node
// Codex marketplace regression eval — validates the generated native package's
// discovery surface, manual-only policy, MCP declaration, and hook payload behavior.
//
//   node evals/codex-marketplace/run.mjs   (exit 0 = pass)

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const pluginsDir = join(root, 'codex-marketplace', 'plugins');
const sourcePluginsDir = join(root, 'plugins');
const pluginNames = ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'];
const read = (path) => readFileSync(path, 'utf8');
const run = (file, input = '') => spawnSync(process.execPath, [file], { input, encoding: 'utf8' });
const fails = [];
const expect = (condition, message) => { if (!condition) fails.push(message); };

for (const plugin of pluginNames) {
  const sourceSkills = readdirSync(join(sourcePluginsDir, plugin, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const codexSkills = readdirSync(join(pluginsDir, plugin, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  expect(JSON.stringify(codexSkills) === JSON.stringify(sourceSkills), `${plugin}: generated skills do not match canonical source`);

  const manifest = JSON.parse(read(join(pluginsDir, plugin, '.codex-plugin', 'plugin.json')));
  expect(manifest.name === plugin && typeof manifest.version === 'string', `${plugin}: native manifest is incomplete`);
  for (const skill of codexSkills) {
    const skillRoot = join(pluginsDir, plugin, 'skills', skill);
    const skillText = read(join(skillRoot, 'SKILL.md'));
    const policy = read(join(skillRoot, 'agents', 'openai.yaml'));
    expect(skillText.startsWith(`---\nname: ${skill}\n`), `${plugin}/${skill}: missing Codex skill name`);
    expect(!skillText.includes('disable-model-invocation') && !skillText.includes('${CLAUDE_PLUGIN_ROOT}'), `${plugin}/${skill}: Claude-only skill syntax leaked`);
    expect(policy.includes('allow_implicit_invocation: false'), `${plugin}/${skill}: manual-only policy is missing`);
  }
}

const mcp = JSON.parse(read(join(pluginsDir, 'code-ops-suite', '.mcp.json')));
expect(mcp.mcpServers?.['code-ops-docs']?.command === 'node', 'code-ops-suite: missing code-ops-docs MCP command');
expect(mcp.mcpServers?.['code-ops-docs']?.args?.[0] === './scripts/lib-docs-mcp.mjs', 'code-ops-suite: MCP script path is wrong');

const preCommit = read(join(root, '.githooks', 'pre-commit'));
expect(preCommit.includes('node scripts/build-codex-marketplace.mjs'), 'pre-commit hook does not regenerate the Codex marketplace');
expect(preCommit.includes('git add -A -- .agents/plugins/marketplace.json codex-marketplace/'), 'pre-commit hook stages the wrong paths');
expect(preCommit.includes('git diff --cached --quiet -- $renderer_paths'), 'pre-commit hook does not skip unrelated commits');
expect(preCommit.includes('git ls-files --others --exclude-standard -- $renderer_inputs'), 'pre-commit hook does not reject untracked renderer inputs');

const hookInstaller = read(join(root, 'scripts', 'install-git-hooks.mjs'));
expect(hookInstaller.includes("git(['config', '--get', 'core.hooksPath'])"), 'hook installer does not protect an effective inherited hooks path');

const hook = join(pluginsDir, 'code-ops-suite', 'hooks', 'enforce-traceless.mjs');
const blocked = run(hook, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m "Generated with Codex"' } }));
const allowed = run(hook, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }));
expect(blocked.status === 2, `traceless hook should block a Codex-shaped traced commit payload, got ${blocked.status}`);
expect(allowed.status === 0, `traceless hook should allow a Codex-shaped safe payload, got ${allowed.status}`);

if (fails.length) {
  console.error('FAIL — Codex marketplace eval:');
  for (const failure of fails) console.error('  x ' + failure);
  process.exit(1);
}
console.log('PASS — Codex marketplace: skill parity, manual-only policies, MCP declaration, and Codex-shaped hook payload all hold.');
