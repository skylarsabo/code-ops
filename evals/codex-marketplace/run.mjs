#!/usr/bin/env node
// Codex marketplace regression eval — validates the generated native package's
// discovery surface, model-invocable policy, MCP declaration, and hook payload behavior.
//
//   node evals/codex-marketplace/run.mjs   (exit 0 = pass)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_ALIAS_TIER } from '../../scripts/model-tiers.mjs';
import { COMMAND_CASES } from '../ai-tells/command-cases.mjs';

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
    expect(policy.includes('allow_implicit_invocation: true'), `${plugin}/${skill}: invocation policy missing or stale`);
    expect(!policy.includes('allow_implicit_invocation: false'), `${plugin}/${skill}: stale manual-only policy leaked into openai.yaml`);
  }

  const sourceAgentsDir = join(sourcePluginsDir, plugin, 'agents');
  if (existsSync(sourceAgentsDir)) {
    const sourceFloors = readdirSync(sourceAgentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => {
        const text = read(join(sourceAgentsDir, entry.name));
        const name = text.match(/^name:[ \t]*(\S+)/m)?.[1];
        const sourceModel = text.match(/^model:[ \t]*(\S+)/m)?.[1];
        return { name, sourceModel, minimumTier: CLAUDE_ALIAS_TIER[sourceModel] };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const floorPath = join(pluginsDir, plugin, 'agents', 'model-floors.json');
    expect(existsSync(floorPath), `${plugin}: generated agent floor contract is missing`);
    if (existsSync(floorPath)) {
      const floors = JSON.parse(read(floorPath));
      expect(floors.version === 1, `${plugin}: agent floor contract has the wrong version`);
      expect(JSON.stringify(floors.roles) === JSON.stringify(sourceFloors), `${plugin}: agent floor contract diverged from canonical agents`);
    }
    for (const agent of sourceFloors) {
      const rendered = read(join(pluginsDir, plugin, 'agents', `${agent.name}.md`));
      expect(!/^model:/m.test(rendered) && !/^tools:/m.test(rendered), `${plugin}/${agent.name}: Claude-only agent controls leaked`);
      expect(rendered.includes('agents/model-floors.json') && rendered.includes(`\`${agent.minimumTier}\``), `${plugin}/${agent.name}: role brief does not direct the lead to its floor contract`);
      expect(!/\b(?:Bash|Write) (?:is|and|are)\b|\buse (?:Grep|Read)\b/.test(rendered), `${plugin}/${agent.name}: role brief names a stripped Claude tool`);
    }
  }
}

// The tools line is stripped, so the role contract header must carry write capability.
const WRITER = 'This role may write files only for its report and repro artifacts.';
const READ_ONLY = 'This role is read-only: return the report inline.';
const verifierBrief = read(join(pluginsDir, 'rigor', 'agents', 'verifier.md'));
expect(verifierBrief.includes(WRITER) && !verifierBrief.includes(READ_ONLY), 'rigor/verifier: role contract does not state its report-file write capability');
const EDITOR = 'This role edits files only inside the Scope its brief names, and writes its report to the path the brief names.';
const implementerBrief = read(join(pluginsDir, 'code-ops-suite', 'agents', 'implementer.md'));
expect(implementerBrief.includes(EDITOR) && !implementerBrief.includes(WRITER) && !implementerBrief.includes(READ_ONLY), 'code-ops-suite/implementer: role contract does not state its scoped edit capability');
for (const [plugin, role] of [['code-ops-suite', 'explorer'], ['privacy-opsec-suite', 'privacy-reviewer']]) {
  const brief = read(join(pluginsDir, plugin, 'agents', `${role}.md`));
  expect(brief.includes(READ_ONLY) && !brief.includes(WRITER), `${plugin}/${role}: role contract does not state it is read-only`);
}

// The compatibility page and README list every bundled hook command, not only the traceless one.
const renderedHooks = JSON.parse(read(join(pluginsDir, 'code-ops-suite', 'hooks', 'hooks.json'))).hooks ?? {};
const hookScripts = Object.values(renderedHooks).flat().flatMap((group) => group.hooks ?? [])
  .map((entry) => entry.command.match(/hooks\/([\w.-]+\.mjs)/)?.[1]);
const compatPage = read(join(pluginsDir, 'code-ops-suite', 'PLATFORM_COMPATIBILITY.md'));
const suiteReadme = read(join(pluginsDir, 'code-ops-suite', 'README.md'));
expect(compatPage.includes(`retains ${hookScripts.length} hook commands on ${Object.keys(renderedHooks).length} events`), 'compatibility page misstates the bundled hook count');
for (const script of hookScripts) {
  expect(compatPage.includes(`\`${script}\`: `), `compatibility page omits the ${script} hook`);
  expect(suiteReadme.includes(`\`${script}\`: `), `README omits the ${script} hook`);
}
expect(compatPage.includes('reviews and trusts') && suiteReadme.includes('review and trust'), 'hook trust step is missing');

const mcp = JSON.parse(read(join(pluginsDir, 'code-ops-suite', '.mcp.json')));
expect(mcp.mcpServers?.['code-ops-docs']?.command === 'node', 'code-ops-suite: missing code-ops-docs MCP command');
expect(mcp.mcpServers?.['code-ops-docs']?.args?.[0] === './scripts/lib-docs-mcp.mjs', 'code-ops-suite: MCP script path is wrong');
expect(mcp.mcpServers?.['code-ops-query']?.command === 'node', 'code-ops-suite: missing code-ops-query MCP command');
expect(mcp.mcpServers?.['code-ops-query']?.args?.[0] === './scripts/context-query-mcp.mjs', 'code-ops-suite: query MCP script path is wrong');
// Each declared server has to reach the rendered package with its script bundled beside it.
for (const [server, spec] of Object.entries(mcp.mcpServers ?? {})) {
  const script = join(pluginsDir, 'code-ops-suite', (spec.args ?? [])[0]?.replace(/^\.\//, '') ?? '');
  expect(existsSync(script), `code-ops-suite: the ${server} server points at ${script}, which is absent`);
}

const preCommit = read(join(root, '.githooks', 'pre-commit'));
expect(preCommit.includes('node scripts/build-codex-marketplace.mjs'), 'pre-commit hook does not regenerate the Codex marketplace');
expect(preCommit.includes('git add -A -- .agents/plugins/marketplace.json codex-marketplace/'), 'pre-commit hook stages the wrong paths');
expect(preCommit.includes('git diff --cached --quiet -- $renderer_paths'), 'pre-commit hook does not skip unrelated commits');
expect(preCommit.includes('git ls-files --others --exclude-standard -- $renderer_inputs'), 'pre-commit hook does not reject untracked renderer inputs');
expect(preCommit.includes('retry_on_index_lock git add -A -- .agents/plugins/marketplace.json codex-marketplace/'), 'pre-commit hook does not wait out a busy index lock while staging');
expect(preCommit.includes('case "$lock_error" in') && preCommit.includes('*index.lock*)'), 'pre-commit hook retries staging failures other than index-lock contention');

const hookInstaller = read(join(root, 'scripts', 'install-git-hooks.mjs'));
expect(hookInstaller.includes("git(['config', '--get', 'core.hooksPath'])"), 'hook installer does not protect an effective inherited hooks path');

const hook = join(pluginsDir, 'code-ops-suite', 'hooks', 'enforce-traceless.mjs');
const blocked = run(hook, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m "Generated with Codex"' } }));
const blockedExec = run(hook, JSON.stringify({ toolName: 'functions.exec_command', input: { cmd: 'git commit -m "Generated with Codex"' } }));
const allowed = run(hook, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }));
expect(blocked.status === 2, `traceless hook should block a Codex-shaped traced commit payload, got ${blocked.status}`);
expect(blockedExec.status === 2, `traceless hook should block a Codex exec_command payload, got ${blockedExec.status}`);
expect(allowed.status === 0, `traceless hook should allow a Codex-shaped safe payload, got ${allowed.status}`);
for (const { name, command, blocked: shouldBlock } of COMMAND_CASES) {
  const { status } = run(hook, JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
  expect(status === (shouldBlock ? 2 : 0), `traceless hook should ${shouldBlock ? 'block' : 'allow'} ${name}, got ${status}`);
}
const hookManifest = JSON.parse(read(join(pluginsDir, 'code-ops-suite', 'hooks', 'hooks.json')));
for (const event of ['PreToolUse', 'PostToolUse']) {
  expect((hookManifest.hooks?.[event] ?? []).every((group) => !('matcher' in group)), `${event} retains a Claude-only tool matcher`);
}
const sessionEndTimeouts = (hookManifest.hooks?.SessionEnd ?? []).flatMap((group) => group.hooks ?? []).map((entry) => entry.timeout);
expect(sessionEndTimeouts.length > 0 && sessionEndTimeouts.every((timeout) => timeout <= 3), `Codex SessionEnd timeout exceeds the desktop ceiling: ${sessionEndTimeouts.join(', ')}`);

const routingCard = read(join(pluginsDir, 'code-ops-suite', 'hooks', 'routing-card.mjs'));
expect(!/\/(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):/.test(routingCard), 'routing card retains Claude slash-command syntax');
expect(routingCard.includes('code-ops-suite:debug'), 'routing card does not name the Codex workflow syntax');
expect(routingCard.includes('privacy-opsec-suite:full-sweep'), 'routing card does not name a valid privacy workflow');

// Skills cite vendored execution specs at <plugin-root>/reference/, so each canonical spec must
// reach the package. Only lines naming a host-specific token may differ from the canonical text.
const HOST_SPECIFIC_LINE = /\$\{CLAUDE_PLUGIN_ROOT\}|CLAUDE\.md|Claude Code|\.claude\b|(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):/;
const referenceFiles = [];
for (const plugin of pluginNames) {
  const sourceReference = join(sourcePluginsDir, plugin, 'reference');
  const renderedReference = join(pluginsDir, plugin, 'reference');
  const specs = existsSync(sourceReference) ? readdirSync(sourceReference).filter((file) => file.endsWith('.md')).sort() : [];
  const rendered = existsSync(renderedReference) ? readdirSync(renderedReference).filter((file) => file.endsWith('.md')).sort() : [];
  expect(JSON.stringify(rendered) === JSON.stringify(specs), `${plugin}: rendered reference specs [${rendered.join(', ')}] do not match canonical [${specs.join(', ')}]`);
  for (const spec of specs.filter((file) => rendered.includes(file))) {
    const source = read(join(sourceReference, spec)).replace(/\r\n/g, '\n').split('\n');
    const text = read(join(renderedReference, spec)).replace(/\r\n/g, '\n');
    referenceFiles.push(join(renderedReference, spec));
    expect(!text.includes('${CLAUDE_PLUGIN_ROOT}'), `${plugin}/reference/${spec}: Claude plugin-root token leaked`);
    if (source.some((line) => line.includes('${CLAUDE_PLUGIN_ROOT}'))) expect(text.includes('<plugin-root>'), `${plugin}/reference/${spec}: plugin-root token was dropped rather than translated`);
    const lines = text.split('\n');
    expect(lines.length === source.length, `${plugin}/reference/${spec}: line count diverged from canonical`);
    const drifted = source.findIndex((line, index) => !HOST_SPECIFIC_LINE.test(line) && lines[index] !== line);
    expect(drifted === -1, `${plugin}/reference/${spec}: line ${drifted + 1} diverged from canonical without a host token`);
  }
}

const portableFiles = [
  ...pluginNames.map((plugin) => join(pluginsDir, plugin, 'CONVENTIONS.md')),
  ...referenceFiles,
  ...readdirSync(join(pluginsDir, 'code-ops-suite', 'hooks')).filter((file) => file.endsWith('.mjs')).map((file) => join(pluginsDir, 'code-ops-suite', 'hooks', file)),
  ...['context-audit.mjs', 'context-query.mjs', 'digest.mjs', 'transcript-lib.mjs'].map((file) => join(pluginsDir, 'code-ops-suite', 'scripts', file)),
];
for (const file of portableFiles) {
  const text = read(file);
  if (!file.endsWith('transcript-lib.mjs')) {
    expect(!text.includes('~/.claude/') && !text.includes('.claude/settings.json'), `${file}: retains a Claude-only storage or settings assumption`);
  }
  expect(!text.includes('its the host environment') && !text.includes('the host environment sets') && !text.includes('the host environment environment'), `${file}: contains malformed host-environment prose`);
}
expect(read(join(pluginsDir, 'code-ops-suite', 'hooks', 'session-receipt.mjs')).includes("'.codex'"), 'session receipt does not use Codex storage by default');

const contextAudit = read(join(pluginsDir, 'code-ops-suite', 'scripts', 'context-audit.mjs'));
const transcriptLib = read(join(pluginsDir, 'code-ops-suite', 'scripts', 'transcript-lib.mjs'));
expect(contextAudit.includes("const opt = { host: 'codex'"), 'context audit does not default to the Codex host');
expect(transcriptLib.includes("join(homedir(), '.claude', 'projects'"), 'transcript library corrupted its explicit Claude transcript branch');
expect(transcriptLib.includes("join(homedir(), '.codex')"), 'transcript library lost its explicit Codex transcript branch');

const conform = read(join(pluginsDir, 'code-ops-suite', 'skills', 'conform', 'SKILL.md'));
expect(conform.includes('`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and `~/.codex/AGENTS.md`'), 'global-standards render collapsed the three host-specific contract paths');
expect(conform.includes('`CLAUDE.md` and `AGENTS.md`'), 'repo-standards render collapsed the accepted two-file parity modes');
expect(conform.includes('Claude reads the global pair under `~/.claude/`') && conform.includes('Codex reads `~/.codex/AGENTS.md`'), 'repo-standards render collapsed the distinct global contract homes');

if (fails.length) {
  console.error('FAIL — Codex marketplace eval:');
  for (const failure of fails) console.error('  x ' + failure);
  process.exit(1);
}
console.log('PASS — Codex marketplace: skill, agent-floor, portable-runtime, MCP, and hook payload checks hold.');
