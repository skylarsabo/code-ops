#!/usr/bin/env node
// Grok Build compatibility eval — asserts the CANONICAL plugin packages still satisfy Grok
// Build's discovery contract.
//
// WHY there is no renderer here, unlike Codex and opencode: Grok Build reads the Claude
// plugin format natively. Its manifest resolver accepts `.claude-plugin/plugin.json`, its
// plugin discovery walks `~/.claude/plugins/`, its agent discovery walks `.claude/agents/`,
// and its hook adapter exports `CLAUDE_PLUGIN_ROOT` alongside `GROK_PLUGIN_ROOT`. So the
// source packages ARE the Grok Build packages, and the only thing that can break is a
// change here that quietly steps outside the contract.
//
// Every assertion below is anchored to xai-org/grok-build at the paths named in its comment,
// so a reader can check the claim rather than trust this file.
//
//   node evals/grok-build-compat/run.mjs   (exit 0 = pass)
//
// When the `grok` CLI is on PATH, its own `grok plugin validate` runs as a bonus check.
// CI has no grok binary, so that leg is skipped rather than failed — the static assertions
// are the gate.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const pluginsDir = join(root, 'plugins');
const pluginNames = ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'];
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const fails = [];
const expect = (condition, message) => { if (!condition) fails.push(message); };

// src/plugins/manifest.rs — MANIFEST_PATHS, in resolution order.
const MANIFEST_PATHS = ['plugin.json', '.grok-plugin/plugin.json', '.claude-plugin/plugin.json'];
// src/plugins/manifest.rs — MAX_PLUGIN_NAME_LEN.
const MAX_PLUGIN_NAME_LEN = 64;
// src/xai-grok-hooks/src/event.rs — HookEventName variants. An event outside this set is
// silently dropped by prefilter_unsupported_events(), so a typo costs the gate with no error.
const SUPPORTED_HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification', 'SubagentStop', 'PreCompact',
]);

for (const plugin of pluginNames) {
  const pluginRoot = join(pluginsDir, plugin);

  // 1. The manifest must resolve at one of the accepted paths.
  const manifestPath = MANIFEST_PATHS.map((rel) => join(pluginRoot, rel)).find(existsSync);
  expect(manifestPath !== undefined, `${plugin}: no manifest at any of ${MANIFEST_PATHS.join(', ')}`);
  if (!manifestPath) continue;
  const manifest = JSON.parse(read(manifestPath));
  expect(manifest.name === plugin, `${plugin}: manifest name is "${manifest.name}"`);
  expect(manifest.name.length <= MAX_PLUGIN_NAME_LEN, `${plugin}: name exceeds Grok Build's ${MAX_PLUGIN_NAME_LEN}-character limit`);

  // 2. src/plugins/discovery.rs — a directory only registers as a plugin when it has
  //    skills/ or commands/. A plugin that lost both would vanish from discovery silently.
  expect(existsSync(join(pluginRoot, 'skills')) || existsSync(join(pluginRoot, 'commands')),
    `${plugin}: neither skills/ nor commands/ exists, so Grok Build would not register it as a plugin`);

  // 3. Agents are discovered from the plugin's agents/ dir by the default convention.
  const agentsDir = join(pluginRoot, 'agents');
  expect(existsSync(agentsDir), `${plugin}: no agents/ directory`);
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      const header = read(join(agentsDir, file)).match(/^---\n([\s\S]*?)\n---/);
      expect(header !== null, `${plugin}/agents/${file}: no frontmatter, so the definition is dropped`);
      // Grok Build namespaces plugin agents as `<plugin>:<name>`, so a name is required.
      expect(header && /^name:[ \t]*\S+/m.test(header[1]), `${plugin}/agents/${file}: no name field`);
    }
  }

  // 4. Hooks must use only events Grok Build's parser accepts, and must reference the plugin
  //    root through ${CLAUDE_PLUGIN_ROOT} — src/plugins/hooks_adapter.rs exports that name
  //    (and GROK_PLUGIN_ROOT) into the hook process environment.
  const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    const hooks = JSON.parse(read(hooksPath));
    const events = Object.keys(hooks.hooks ?? {});
    expect(events.length > 0, `${plugin}: hooks.json declares no events`);
    for (const event of events) {
      expect(SUPPORTED_HOOK_EVENTS.has(event), `${plugin}: hook event "${event}" is not in Grok Build's supported set and would be dropped silently`);
    }
    expect(read(hooksPath).includes('${CLAUDE_PLUGIN_ROOT}'),
      `${plugin}: hooks.json does not resolve its command through \${CLAUDE_PLUGIN_ROOT}`);
  }

  // 5. src/plugins/manifest.rs — `mcp_servers` is a PathOrInline. Both forms are supported,
  //    so the check is that whichever form is used actually resolves to a real script.
  if (manifest.mcpServers) {
    if (typeof manifest.mcpServers === 'string') {
      const declared = join(pluginRoot, manifest.mcpServers.replace(/^\.\//, ''));
      expect(existsSync(declared), `${plugin}: manifest declares mcpServers "${manifest.mcpServers}" but ${declared} is absent`);
    } else {
      for (const [server, spec] of Object.entries(manifest.mcpServers)) {
        // Grok Build substitutes ${CLAUDE_PLUGIN_ROOT} in the spawned command, so the
        // bundled script the args name has to exist under the plugin root.
        const scriptArg = (spec.args ?? []).find((arg) => typeof arg === 'string' && arg.includes('${CLAUDE_PLUGIN_ROOT}'));
        expect(scriptArg !== undefined, `${plugin}: inline MCP server "${server}" does not resolve its script through \${CLAUDE_PLUGIN_ROOT}`);
        if (!scriptArg) continue;
        const script = join(pluginRoot, scriptArg.replace('${CLAUDE_PLUGIN_ROOT}/', ''));
        expect(existsSync(script), `${plugin}: inline MCP server "${server}" points at ${script}, which is absent`);
      }
    }
  }
}

// 6. The skills reference bundled scripts through ${CLAUDE_PLUGIN_ROOT}, which Grok Build
//    substitutes in plugin agent bodies (src/discovery.rs, substitute_plugin_vars). A skill
//    that switched to a Claude-only spelling would break the path on this host.
for (const plugin of pluginNames) {
  const skillsDir = join(pluginsDir, plugin, 'skills');
  if (!existsSync(skillsDir)) continue;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = read(join(skillsDir, entry.name, 'SKILL.md'));
    // Only skills that actually name a bundled script need the token.
    if (!/scripts\/[a-z-]+\.mjs/.test(text)) continue;
    expect(text.includes('${CLAUDE_PLUGIN_ROOT}'),
      `${plugin}/${entry.name}: names a bundled script without \${CLAUDE_PLUGIN_ROOT}, which Grok Build relies on to resolve it`);
  }
}

// 7. Bonus leg: Grok Build's own validator, when the binary is available.
// Windows resolves `grok` through a .cmd shim, which needs a shell. Passing the whole
// command as one shell string (rather than an args array) avoids the escaping hazard Node
// warns about; every interpolated value here is a literal from the pluginNames const above.
const shell = process.platform === 'win32';
const grokRun = (command) => spawnSync(shell ? command : command.split(' ')[0], shell ? undefined : command.split(' ').slice(1), { cwd: root, encoding: 'utf8', shell });
if (grokRun('grok --version').status === 0) {
  for (const plugin of pluginNames) {
    const result = grokRun(`grok plugin validate plugins/${plugin}`);
    expect(result.status === 0 && /valid/i.test(result.stdout), `${plugin}: grok plugin validate failed — ${(result.stdout + result.stderr).trim().split('\n')[0]}`);
  }
  console.log('(grok CLI present — its own plugin validator ran too)');
} else {
  console.log('(grok CLI not on PATH — static contract assertions are the gate)');
}

if (fails.length) {
  console.error('FAIL — Grok Build compatibility eval:');
  for (const failure of fails) console.error('  x ' + failure);
  process.exit(1);
}
console.log(`PASS — Grok Build compatibility: ${pluginNames.length} canonical plugins resolve, register, and expose agents, hooks, and MCP through the contract Grok Build reads natively.`);
