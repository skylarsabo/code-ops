#!/usr/bin/env node
// Render and verify the tracked Codex distribution from the canonical Claude source.
//
// WHY: Claude and Codex need incompatible skill headers and path conventions from the
// same source of truth; hand-editing codex-marketplace/ would let the two hosts drift
// apart silently. Rendering it deterministically lets `--check` catch that drift in CI.
//
//   node scripts/build-codex-marketplace.mjs
//   node scripts/build-codex-marketplace.mjs --check
//
// The hosts require incompatible skill headers: Claude skills are model-invocable (the
// harness routes slash input through the Skill tool, so there is no separate manual-only
// mode to preserve), and this renderer gives Codex each skill a `name` plus an explicit
// `allow_implicit_invocation: true` policy that mirrors that. Never hand-edit
// codex-marketplace/; use this script instead.
//
// Exit: 0 = written (default mode) or already up to date (--check); 1 = --check found
// drift (stale/missing/unexpected generated file); 2 = usage error (unknown flag). A
// source-validation failure (e.g. a plugin manifest missing a required field) throws and
// exits the process non-zero before either mode writes or compares anything.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_ALIAS_TIER } from './model-tiers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PLUGINS = resolve(ROOT, 'plugins');
const OUTPUT_ROOT = resolve(ROOT, 'codex-marketplace');
const MARKETPLACE_PATH = resolve(ROOT, '.agents', 'plugins', 'marketplace.json');
const CLAUDE_MARKETPLACE_PATH = resolve(ROOT, '.claude-plugin', 'marketplace.json');

const PLUGINS = [
  {
    name: 'code-ops-suite',
    displayName: 'Code Ops Suite',
    shortDescription: 'Broad engineering audits, implementation, tests, docs, and reviews.',
    category: 'Productivity',
    capabilities: ['Read', 'Write', 'Review', 'Workflow'],
    defaultPrompt: [
      'Run code-ops-suite:codebase-audit on this repo.',
      'Use code-ops-suite:ship for this change.',
      'Use code-ops-suite:debug for this symptom.',
    ],
    brandColor: '#2563EB',
    mcp: true,
  },
  {
    name: 'privacy-opsec-suite',
    displayName: 'Privacy OpSec Suite',
    shortDescription: 'Privacy, anonymity, egress, metadata, and OpSec workflows.',
    category: 'Security',
    capabilities: ['Read', 'Write', 'Review', 'Workflow'],
    defaultPrompt: [
      'Run privacy-opsec-suite:anonymity-threat-model.',
      'Use privacy-opsec-suite:tor-egress-audit.',
      'Use privacy-opsec-suite:opsec-pr-gate on this diff.',
    ],
    brandColor: '#047857',
  },
  {
    name: 'rigor',
    displayName: 'Rigor',
    shortDescription: 'Verification-first bug hunting, proof, and regression enforcement.',
    category: 'Productivity',
    capabilities: ['Read', 'Write', 'Review', 'Workflow'],
    defaultPrompt: [
      'Run rigor:ground-truth, then rigor:bug-hunt.',
      'Use rigor:deep-review on my current branch.',
      'Use rigor:fix-verified for confirmed bugs.',
    ],
    brandColor: '#7C3AED',
  },
  {
    name: 'researcher',
    displayName: 'Researcher',
    shortDescription: 'Code-grounded research with cited claims and disclosed egress.',
    category: 'Productivity',
    capabilities: ['Read', 'Review', 'Research', 'Workflow'],
    defaultPrompt: [
      'Run researcher:research-spike for this task.',
      'Use researcher:library-eval for this choice.',
      'Use researcher:research-verify on this claim.',
    ],
    brandColor: '#B45309',
  },
];

const KNOWN_COMMANDS = /\/(code-ops-suite|privacy-opsec-suite|rigor|researcher):([a-z0-9-]+)/g;
const ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
const CODEX_ROOT_TOKEN = '${PLUGIN_ROOT}';
const CODEX_SESSION_END_TIMEOUT_SECONDS = 3;
const CLAUDE_CONTRACT_SENTINEL = '__CODE_OPS_CLAUDE_CONTRACT__';
const CLAUDE_HOME_SENTINEL = '__CODE_OPS_CLAUDE_HOME__';
const CHECK = process.argv.includes('--check');

if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  console.error('usage: node scripts/build-codex-marketplace.mjs [--check]');
  process.exit(2);
}

function assertInsideRoot(path) {
  const rel = relative(ROOT, path);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`refusing to operate outside the repository root: ${path}`);
  }
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function sourcePath(...parts) {
  const path = resolve(SOURCE_PLUGINS, ...parts);
  assertInsideRoot(path);
  return path;
}

function outputPath(...parts) {
  const path = resolve(OUTPUT_ROOT, ...parts);
  assertInsideRoot(path);
  return path;
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(root);
  return files;
}

function portableText(contents, { preserveClaudeContract = false, preservePairedContracts = false, preserveClaudeHome = false } = {}) {
  let guarded = contents;
  if (preserveClaudeContract) guarded = guarded.replaceAll('CLAUDE.md', CLAUDE_CONTRACT_SENTINEL);
  else if (preservePairedContracts) {
    guarded = guarded.split('\n').map((line) => line.includes('CLAUDE.md') && line.includes('AGENTS.md')
      ? line.replaceAll('CLAUDE.md', CLAUDE_CONTRACT_SENTINEL)
      : line).join('\n');
  }
  if (preserveClaudeHome) guarded = guarded.replaceAll('~/.claude/', CLAUDE_HOME_SENTINEL);

  return guarded
    .replaceAll(ROOT_TOKEN, '<plugin-root>')
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('Claude Code', 'Codex')
    .replaceAll('~/.claude/', '~/.codex/')
    .replace(/the `env` block of (?:a|its)\s*`\.claude\/settings\.json`/g, 'the host environment')
    .replaceAll('environment block of a `.claude/settings.json`', 'host environment')
    .replaceAll('`.claude/settings.json`, which is the only supported way', 'the host environment')
    .replaceAll('`.claude/settings.json`', 'the host environment')
    .replaceAll('the canonical the host environment environment', 'the host environment')
    .replaceAll('the host environment sets', 'the host environment supplies')
    .replace(KNOWN_COMMANDS, '$1:$2')
    .replaceAll(CLAUDE_CONTRACT_SENTINEL, 'CLAUDE.md')
    .replaceAll(CLAUDE_HOME_SENTINEL, '~/.claude/');
}

function portableRuntimeText(contents, file = '') {
  let portable = portableText(contents);
  const name = file.split(/[\\/]/).at(-1);
  // transcript-lib owns an explicit Claude/Codex branch. Rewriting both literals makes
  // `--host claude` point at Codex storage, so only host-local defaults are translated.
  if (name !== 'transcript-lib.mjs') portable = portable.replaceAll("'.claude'", "'.codex'");
  if (name === 'context-audit.mjs') portable = portable.replace("host: 'claude'", "host: 'codex'");
  return portable;
}

function parseSkill(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${path}: expected YAML frontmatter bounded by ---`);
  const lines = match[1].split('\n');
  const description = lines.find((line) => line.startsWith('description:'));
  if (!description) throw new Error(`${path}: source skill is missing description frontmatter`);
  return { header: lines, body: match[2], description };
}

function descriptionValue(line) {
  const raw = line.slice('description:'.length).trim();
  if (!raw) throw new Error('skill description must not be blank');
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return raw;
}

function titleCase(slug) {
  const acronyms = new Map([
    ['api', 'API'],
    ['adr', 'ADR'],
    ['mcp', 'MCP'],
    ['opsec', 'OpSec'],
    ['tor', 'Tor'],
    ['xfn', 'XFN'],
  ]);
  return slug.split('-').map((part) => acronyms.get(part) ?? (part[0].toUpperCase() + part.slice(1))).join(' ');
}

function transformSkill(pluginName, slug, contents, path) {
  const { header, body } = parseSkill(contents, path);
  const keptHeader = header.filter((line) => !/^(name|disable-model-invocation|disable_model_invocation):/.test(line));
  const command = `${pluginName}:${slug}`;
  const marker = `**Invoked as \`/${command}\`.**`;
  if (!body.includes(marker)) throw new Error(`${path}: expected invocation marker ${marker}`);
  let transformed = body.replace(
    marker,
    `**Codex path rule:** Resolve \`<plugin-root>\` as the installed root of this plugin (the directory containing \`CONVENTIONS.md\`); use it for every bundled script or reference path.\n\n**Invoke in Codex by naming \`${command}\`.**`,
  );
  const crossHostStandards = pluginName === 'code-ops-suite' && (slug === 'adopt-global-standards' || slug === 'adopt-standards');
  transformed = portableText(transformed, {
    preserveClaudeContract: slug === 'adopt-global-standards',
    preservePairedContracts: slug === 'adopt-standards',
    preserveClaudeHome: crossHostStandards,
  });
  return `---\nname: ${slug}\n${keptHeader.join('\n')}\n---\n${transformed}`;
}

function agentFloor(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${path}: expected YAML frontmatter bounded by ---`);
  const name = match[1].match(/^name:[ \t]*(\S+)/m)?.[1];
  const sourceModel = match[1].match(/^model:[ \t]*(\S+)/m)?.[1];
  const minimumTier = CLAUDE_ALIAS_TIER[sourceModel];
  if (!name || !sourceModel || !minimumTier) {
    throw new Error(`${path}: agent needs a name and a model with a known tier`);
  }
  return { name, sourceModel, minimumTier };
}

function transformAgent(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${path}: expected YAML frontmatter bounded by ---`);
  const floor = agentFloor(contents, path);
  // The tools line is stripped below, so the header restates the one capability a brief
  // depends on: whether the role edits source, writes only its own report file, or returns
  // the report inline.
  const tools = match[1].match(/^tools:[ \t]*(.*)$/m)?.[1] ?? '';
  const writeCapability = /\b(?:Edit|MultiEdit|NotebookEdit)\b/.test(tools)
    ? 'This role edits files only inside the Scope its brief names, and writes its report to the path the brief names.'
    : /\bWrite\b/.test(tools)
      ? 'This role may write files only for its report and repro artifacts.'
      : 'This role is read-only: return the report inline.';
  const header = match[1].split('\n').filter((line) => !/^(tools|model):/.test(line)).map(portableText);
  const body = portableText(match[2]);
  return [
    '---',
    ...header,
    '---',
    '',
    `> Codex role contract: this file is a briefing template for a collaboration subagent. Before dispatch, the lead reads \`agents/model-floors.json\` and routes \`${floor.name}\` at or above its \`${floor.minimumTier}\` floor. ${writeCapability}`,
    '',
    body,
  ].join('\n');
}

function agentFloors(sourceAgents) {
  return walkFiles(sourceAgents)
    .filter((file) => file.endsWith('.md'))
    .map((file) => agentFloor(readText(file), file))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function skillAgentYaml(pluginName, slug, description) {
  return [
    'interface:',
    `  display_name: ${JSON.stringify(titleCase(slug))}`,
    `  short_description: ${JSON.stringify(description)}`,
    `  default_prompt: ${JSON.stringify(`Use ${pluginName}:${slug} for this task.`)}`,
    'policy:',
    '  allow_implicit_invocation: true',
    '',
  ].join('\n');
}

// One short purpose per bundled hook script. A hook script missing here fails the build, so
// a new hook cannot ship with an undocumented purpose on the compatibility page.
const HOOK_PURPOSES = new Map([
  ['enforce-traceless.mjs', 'blocks a commit or pull-request command whose published text carries attribution traces'],
  ['digest-rewrite.mjs', 'routes a simple shell command through the output digest so long output arrives compressed'],
  ['index-refresh.mjs', 're-indexes a file right after a tool edits it, so context queries read the live tree'],
  ['routing-card.mjs', 'prints the routing card at session start, a restore instruction after compaction, and the newest pending handoff on a fresh session'],
  ['session-receipt.mjs', 'appends a local session receipt row with token usage, tool calls, and model mix'],
  ['ladder-card.mjs', 'hands an implementer subagent the code-economy ladder card'],
  ['handoff-card.mjs', 'prompts the lead to assess continue, compact, or handoff at a safe boundary when resident context crosses each 150,000-token band'],
  ['dispatch-guard.mjs', 'holds a subagent to its brief’s round budget, denies a wide-surface dispatch that names no reason, gates new dispatches past the context ceiling until a handoff assessment, and flags a dispatch that overrides a declared tier'],
]);

function bundledHooks(pluginName) {
  const manifest = JSON.parse(readText(sourcePath(pluginName, 'hooks', 'hooks.json')));
  return Object.entries(manifest.hooks ?? {}).flatMap(([event, groups]) => groups
    .flatMap((group) => group.hooks ?? [])
    .map((hook) => {
      const script = hook.command?.match(/hooks\/([\w.-]+\.mjs)/)?.[1];
      const purpose = HOOK_PURPOSES.get(script);
      if (!purpose) throw new Error(`${pluginName}/hooks/hooks.json: no documented purpose for hook command ${hook.command}`);
      return { event, script, purpose };
    }));
}

const hookLine = (hook) => `\`${hook.event}\` \`${hook.script}\`: ${hook.purpose}.`;

const mcpNames = (manifest) => Object.keys(manifest.mcpServers ?? {}).map((name) => `\`${name}\``).join(', ');

function generatedReadme(spec, manifest, skills) {
  const lines = [
    `# ${spec.displayName} for Codex`,
    '',
    '> Generated in the code-ops repository (https://github.com/skylarsabo/code-ops) by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.',
    '',
    manifest.description,
    '',
    '## Use',
    '',
    `Name a workflow in Codex as \`${spec.name}:<skill>\`. Every generated skill sets \`policy.allow_implicit_invocation: true\`, matching the Claude-side model-invocable policy.`,
    '',
    '## Skills',
    '',
    ...skills.map((skill) => `- \`${skill.slug}\` — ${skill.description}`),
    '',
    '## Packaging notes',
    '',
    '- The complete workflow text and conventions are rendered from `plugins/' + spec.name + '/` in the code-ops repository.',
    '- Claude-specific GitHub Action examples are intentionally not bundled here.',
    '- Root-level `agents/*.md` files are collaboration-subagent briefing templates. Their machine-readable minimum tiers are in `agents/model-floors.json`; the lead selects a supported runtime model before dispatch.',
  ];
  if (spec.mcp) lines.push(`- The package bundles optional, plugin-scoped MCP servers: ${mcpNames(manifest)}.`);
  if (existsSync(sourcePath(spec.name, 'hooks', 'hooks.json'))) {
    const hooks = bundledHooks(spec.name);
    lines.push(`- The package bundles ${hooks.length} hook commands. Codex requires the user to review and trust plugin hooks before they run.`);
    lines.push(...hooks.map((hook) => `  - ${hookLine(hook)}`));
  }
  lines.push('', 'For source history and release notes, see the generated `CHANGELOG.md` and the repository root.', '');
  return lines.join('\n');
}

function compatibilityNotes(spec, sourceManifest) {
  const lines = [
    '# Platform compatibility',
    '',
    'This Codex package is generated from the canonical Claude package in the code-ops repository (https://github.com/skylarsabo/code-ops). Rebuild it there with `node scripts/build-codex-marketplace.mjs`; CI uses `--check` to prevent drift.',
    '',
    '## Deliberate host transforms',
    '',
    '- Claude skills are model-invocable (the harness routes slash input through the Skill tool, so there is no manual-only mode); Codex requires a skill `name`. This render strips any legacy `disable-model-invocation` field the source may still carry and writes `skills/<skill>/agents/openai.yaml` with `policy.allow_implicit_invocation: true` to mirror that policy.',
    '- `${CLAUDE_PLUGIN_ROOT}` becomes `<plugin-root>` in instructional prose. Codex resolves bundled runtime paths from the installed plugin root.',
    '- Claude slash-command spelling becomes the Codex named-workflow spelling, for example `code-ops-suite:codebase-audit`.',
    '- Claude agent `tools` and `model` frontmatter is removed because Codex does not use it for these role briefs. `agents/model-floors.json` preserves each source alias and canonical minimum tier for runtime routing checks.',
    '- Claude GitHub Action examples are omitted because they are not Codex runtime configuration.',
  ];
  if (existsSync(sourcePath(spec.name, 'hooks', 'hooks.json'))) {
    const hooks = bundledHooks(spec.name);
    const events = new Set(hooks.map((hook) => hook.event));
    lines.push(`- \`hooks/hooks.json\` retains ${hooks.length} hook commands on ${events.size} events. Codex skips plugin hooks until the user reviews and trusts the hook definition.`);
    lines.push(...hooks.map((hook) => `  - ${hookLine(hook)}`));
    lines.push(`- The Codex render caps every \`SessionEnd\` command timeout at ${CODEX_SESSION_END_TIMEOUT_SECONDS} seconds, which matches the desktop host ceiling. The canonical Claude hook timeout is unchanged.`);
  }
  if (spec.mcp) lines.push(`- The render moves each MCP declaration from Claude’s inline manifest entry to Codex \`.mcp.json\` with a plugin-root-relative script path: ${mcpNames(sourceManifest)}.`);
  lines.push('', 'The generated package must continue to pass the Codex plugin validator and marketplace install smoke test.', '');
  return lines.join('\n');
}

function transformCodexHook(contents, file) {
  const rewritten = portableRuntimeText(contents.replaceAll(ROOT_TOKEN, CODEX_ROOT_TOKEN), file);
  if (file.split(/[\\/]/).at(-1) !== 'hooks.json') return rewritten;
  const manifest = JSON.parse(rewritten);
  // Codex tool names are not Claude's Bash/Edit vocabulary. Run the lightweight adapters
  // for every pre/post tool event and let each script filter the normalized payload.
  for (const event of ['PreToolUse', 'PostToolUse']) {
    for (const group of manifest.hooks?.[event] ?? []) delete group.matcher;
  }
  for (const group of manifest.hooks?.SessionEnd ?? []) {
    for (const hook of group.hooks ?? []) {
      if (typeof hook.timeout === 'number' && hook.timeout > CODEX_SESSION_END_TIMEOUT_SECONDS) {
        hook.timeout = CODEX_SESSION_END_TIMEOUT_SECONDS;
      }
    }
  }
  return JSON.stringify(manifest, null, 2) + '\n';
}

function createManifest(spec, sourceManifest) {
  const manifest = {
    name: spec.name,
    version: sourceManifest.version,
    description: sourceManifest.description,
    author: {
      name: sourceManifest.author?.name ?? 'Skylar',
      url: 'https://github.com/skylarsabo',
    },
    homepage: 'https://github.com/skylarsabo/code-ops',
    repository: 'https://github.com/skylarsabo/code-ops',
    license: sourceManifest.license ?? 'MIT',
    keywords: sourceManifest.keywords ?? [],
    skills: './skills/',
    interface: {
      displayName: spec.displayName,
      shortDescription: spec.shortDescription,
      longDescription: sourceManifest.description,
      developerName: sourceManifest.author?.name ?? 'Skylar',
      category: spec.category,
      capabilities: spec.capabilities,
      websiteURL: 'https://github.com/skylarsabo/code-ops',
      defaultPrompt: spec.defaultPrompt,
      brandColor: spec.brandColor,
    },
  };
  if (spec.mcp) manifest.mcpServers = './.mcp.json';
  return manifest;
}

// Derived from the canonical manifest, never a second list: a server added to plugin.json has to
// reach the Codex package too, and a hand-kept copy here would drop it silently.
function createMcpConfig(sourceManifest) {
  const servers = {};
  for (const [name, spec] of Object.entries(sourceManifest.mcpServers ?? {})) {
    servers[name] = {
      command: spec.command ?? 'node',
      args: (spec.args ?? []).map((arg) => (typeof arg === 'string' ? arg.replaceAll(`${ROOT_TOKEN}/`, './') : arg)),
      cwd: '.',
    };
  }
  return { mcpServers: servers };
}

function canonicalMarketplaceEntries() {
  const marketplace = JSON.parse(readText(CLAUDE_MARKETPLACE_PATH));
  if (!Array.isArray(marketplace.plugins)) throw new Error(`${CLAUDE_MARKETPLACE_PATH}: plugins must be an array`);
  const entries = new Map();
  for (const entry of marketplace.plugins) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) throw new Error(`${CLAUDE_MARKETPLACE_PATH}: every plugin needs a name`);
    if (entries.has(entry.name)) throw new Error(`${CLAUDE_MARKETPLACE_PATH}: duplicate plugin ${entry.name}`);
    entries.set(entry.name, entry);
  }
  const registryNames = PLUGINS.map((spec) => spec.name).sort();
  const canonicalNames = [...entries.keys()].sort();
  if (JSON.stringify(registryNames) !== JSON.stringify(canonicalNames)) {
    throw new Error(`${CLAUDE_MARKETPLACE_PATH}: plugin membership must match the Codex renderer registry (canonical: ${canonicalNames.join(', ') || '<none>'}; renderer: ${registryNames.join(', ') || '<none>'})`);
  }
  for (const spec of PLUGINS) {
    const entry = entries.get(spec.name);
    if (entry.source !== `./plugins/${spec.name}`) throw new Error(`${CLAUDE_MARKETPLACE_PATH}: ${spec.name} must use canonical source ./plugins/${spec.name}`);
  }
  return entries;
}

function makeMarketplace() {
  return {
    name: 'code-ops',
    interface: { displayName: 'Code Ops' },
    plugins: PLUGINS.map((spec) => ({
      name: spec.name,
      source: { source: 'local', path: `./codex-marketplace/plugins/${spec.name}` },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: spec.category,
    })),
  };
}

function buildExpectedFiles() {
  const canonicalEntries = canonicalMarketplaceEntries();
  const out = new Map();
  const add = (path, contents) => {
    const key = toPosix(path);
    if (out.has(key)) throw new Error(`renderer produced duplicate path ${key}`);
    out.set(key, contents);
  };
  const addSourceTree = (sourceDir, targetDir, transform = (text) => text) => {
    for (const file of walkFiles(sourceDir)) {
      const rel = toPosix(relative(sourceDir, file));
      add(`${targetDir}/${rel}`, transform(readText(file), file));
    }
  };

  for (const spec of PLUGINS) {
    const sourceDir = sourcePath(spec.name);
    const sourceManifestPath = sourcePath(spec.name, '.claude-plugin', 'plugin.json');
    if (!existsSync(sourceManifestPath)) throw new Error(`${sourceManifestPath}: missing canonical plugin manifest`);
    const sourceManifest = JSON.parse(readText(sourceManifestPath));
    if (sourceManifest.name !== spec.name) throw new Error(`${sourceManifestPath}: name does not match renderer registry`);
    if (canonicalEntries.get(spec.name).version !== sourceManifest.version) {
      throw new Error(`${CLAUDE_MARKETPLACE_PATH}: ${spec.name} version must match ${sourceManifestPath}`);
    }
    const base = `plugins/${spec.name}`;
    const skillsDir = sourcePath(spec.name, 'skills');
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const skills = [];

    for (const entry of skillDirs) {
      const skillPath = sourcePath(spec.name, 'skills', entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) throw new Error(`${skillPath}: missing skill file`);
      const sourceSkill = readText(skillPath);
      const { description } = parseSkill(sourceSkill, skillPath);
      const skillDescription = descriptionValue(description);
      skills.push({ slug: entry.name, description: skillDescription });
      add(`${base}/skills/${entry.name}/SKILL.md`, transformSkill(spec.name, entry.name, sourceSkill, skillPath));
      add(`${base}/skills/${entry.name}/agents/openai.yaml`, skillAgentYaml(spec.name, entry.name, skillDescription));
    }

    add(`${base}/.codex-plugin/plugin.json`, JSON.stringify(createManifest(spec, sourceManifest), null, 2) + '\n');
    add(`${base}/README.md`, generatedReadme(spec, sourceManifest, skills));
    add(`${base}/PLATFORM_COMPATIBILITY.md`, compatibilityNotes(spec, sourceManifest));
    add(`${base}/CONVENTIONS.md`, portableText(readText(sourcePath(spec.name, 'CONVENTIONS.md'))));
    add(`${base}/CHANGELOG.md`, portableText(readText(sourcePath(spec.name, 'CHANGELOG.md'))).replace('`.claude-plugin/plugin.json` and the matching entry in the marketplace.', 'the source plugin manifest and matching marketplace entries.'));
    addSourceTree(sourcePath(spec.name, 'scripts'), `${base}/scripts`, portableRuntimeText);
    // Skills cite vendored execution specs under reference/, so they carry CONVENTIONS.md's transform.
    addSourceTree(sourcePath(spec.name, 'reference'), `${base}/reference`, (text) => portableText(text));

    const sourceAgents = sourcePath(spec.name, 'agents');
    if (existsSync(sourceAgents)) {
      addSourceTree(sourceAgents, `${base}/agents`, transformAgent);
      add(`${base}/agents/model-floors.json`, JSON.stringify({ version: 1, roles: agentFloors(sourceAgents) }, null, 2) + '\n');
    }

    const sourceHooks = sourcePath(spec.name, 'hooks');
    if (existsSync(sourceHooks)) {
      addSourceTree(sourceHooks, `${base}/hooks`, transformCodexHook);
    }
    if (spec.mcp) add(`${base}/.mcp.json`, JSON.stringify(createMcpConfig(sourceManifest), null, 2) + '\n');
  }

  add('README.md', [
    '# Generated Codex marketplace payload',
    '',
    'This directory is generated from the canonical packages under `../plugins/` by `node scripts/build-codex-marketplace.mjs`.',
    '',
    'The repository-root `.agents/plugins/marketplace.json` points Codex at these package directories. Do not edit files here directly; change the source package and rerun the renderer.',
    '',
  ].join('\n'));
  return out;
}

function expect(condition, message) {
  if (!condition) throw new Error(`Codex package validation: ${message}`);
}

function validateExpectedFiles(expected) {
  for (const spec of PLUGINS) {
    const base = `plugins/${spec.name}`;
    const manifestPath = `${base}/.codex-plugin/plugin.json`;
    expect(expected.has(manifestPath), `${manifestPath} is missing`);
    const manifest = JSON.parse(expected.get(manifestPath));
    expect(manifest.name === spec.name, `${manifestPath} has the wrong name`);
    expect(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version), `${manifestPath} has a non-semver version`);
    expect(typeof manifest.description === 'string' && manifest.description.trim(), `${manifestPath} has no description`);
    expect(typeof manifest.author?.name === 'string' && manifest.author.name.trim(), `${manifestPath} has no author.name`);
    for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
      expect(typeof manifest.interface?.[field] === 'string' && manifest.interface[field].trim(), `${manifestPath} has no interface.${field}`);
    }
    expect(Array.isArray(manifest.interface?.capabilities) && manifest.interface.capabilities.length > 0, `${manifestPath} has no interface.capabilities`);
    expect(Array.isArray(manifest.interface?.defaultPrompt) && manifest.interface.defaultPrompt.length > 0, `${manifestPath} has no interface.defaultPrompt`);
    if (spec.mcp) {
      expect(manifest.mcpServers === './.mcp.json', `${manifestPath} must point to .mcp.json`);
      const mcpPath = `${base}/.mcp.json`;
      expect(expected.has(mcpPath), `${mcpPath} is missing`);
      const mcp = JSON.parse(expected.get(mcpPath));
      expect(mcp.mcpServers?.['code-ops-docs']?.command === 'node', `${mcpPath} has no code-ops-docs server`);
      expect(mcp.mcpServers?.['code-ops-docs']?.args?.[0] === './scripts/lib-docs-mcp.mjs', `${mcpPath} has the wrong code-ops-docs path`);
      // Every server the canonical manifest declares must reach the Codex package, with its
      // script path rewritten and the script itself bundled.
      const sourceServers = JSON.parse(readText(sourcePath(spec.name, '.claude-plugin', 'plugin.json'))).mcpServers ?? {};
      for (const [server, sourceSpec] of Object.entries(sourceServers)) {
        const rendered = mcp.mcpServers?.[server];
        expect(rendered !== undefined, `${mcpPath} drops the ${server} server the canonical manifest declares`);
        if (!rendered) continue;
        const script = (sourceSpec.args ?? []).find((arg) => typeof arg === 'string' && arg.startsWith(ROOT_TOKEN));
        expect(script !== undefined, `${spec.name}: MCP server ${server} names no ${ROOT_TOKEN} script`);
        if (!script) continue;
        const relative = script.replace(`${ROOT_TOKEN}/`, './');
        expect(rendered.args?.includes(relative), `${mcpPath}: ${server} must name ${relative}`);
        expect(expected.has(`${base}/${relative.slice(2)}`), `${base}/${relative.slice(2)} is not bundled, so the ${server} server cannot start`);
      }
    }

    const skillPrefix = `${base}/skills/`;
    const skills = [...expected.keys()].filter((path) => path.startsWith(skillPrefix) && path.endsWith('/SKILL.md'));
    expect(skills.length > 0, `${base} has no generated skills`);
    for (const skillPath of skills) {
      const slug = skillPath.slice(skillPrefix.length, -'/SKILL.md'.length);
      const contents = expected.get(skillPath);
      expect(contents.startsWith(`---\nname: ${slug}\n`), `${skillPath} has no matching Codex skill name`);
      expect(!/disable[_-]model[_-]invocation:/i.test(contents), `${skillPath} still carries Claude-only disable-model-invocation`);
      expect(contents.includes('<plugin-root>'), `${skillPath} did not translate the plugin root token`);
      const policyPath = `${skillPrefix}${slug}/agents/openai.yaml`;
      expect(expected.has(policyPath), `${policyPath} is missing`);
      expect(expected.get(policyPath).includes('allow_implicit_invocation: true'), `${policyPath} does not state the model-invocable policy`);
    }
    if (existsSync(sourcePath(spec.name, 'hooks', 'hooks.json'))) {
      const hookPath = `${base}/hooks/hooks.json`;
      expect(expected.has(hookPath), `${hookPath} is missing`);
      expect(expected.get(hookPath).includes(CODEX_ROOT_TOKEN), `${hookPath} does not use PLUGIN_ROOT`);
      const hookManifest = JSON.parse(expected.get(hookPath));
      for (const group of hookManifest.hooks?.SessionEnd ?? []) {
        for (const hook of group.hooks ?? []) {
          expect(hook.timeout <= CODEX_SESSION_END_TIMEOUT_SECONDS, `${hookPath} exceeds the Codex SessionEnd timeout ceiling`);
        }
      }
    }
    if (existsSync(sourcePath(spec.name, 'agents'))) {
      const floorPath = `${base}/agents/model-floors.json`;
      expect(expected.has(floorPath), `${floorPath} is missing`);
      const floors = JSON.parse(expected.get(floorPath));
      expect(floors.version === 1 && Array.isArray(floors.roles), `${floorPath} has an invalid schema`);
      const sourceFloors = agentFloors(sourcePath(spec.name, 'agents'));
      expect(JSON.stringify(floors.roles) === JSON.stringify(sourceFloors), `${floorPath} does not match canonical agent floors`);
    }
  }
  for (const [path, contents] of expected) {
    if (/(?:\/SKILL\.md|\/agents\/[^/]+\.md|\/CONVENTIONS\.md|\/reference\/.+\.md)$/.test(path)) {
      expect(!contents.includes(ROOT_TOKEN), `${path} retains the Claude plugin-root token`);
    }
    if (/^(?:plugins\/[^/]+\/(?:CONVENTIONS\.md|reference\/|hooks\/|scripts\/))/.test(path)
      && !path.endsWith('/scripts/transcript-lib.mjs')) {
      expect(!contents.includes('~/.claude/'), `${path} retains a Claude-only home path`);
      expect(!contents.includes('.claude/settings.json'), `${path} retains a Claude-only settings path`);
    }
  }
  const suiteBase = 'plugins/code-ops-suite';
  const contextAudit = expected.get(`${suiteBase}/scripts/context-audit.mjs`);
  const transcriptLib = expected.get(`${suiteBase}/scripts/transcript-lib.mjs`);
  expect(contextAudit?.includes("const opt = { host: 'codex'"), 'Codex context audit does not default to the Codex host');
  expect(transcriptLib?.includes("join(homedir(), '.claude', 'projects'"), 'Codex transcript library corrupted its explicit Claude branch');
  expect(transcriptLib?.includes("join(homedir(), '.codex')"), 'Codex transcript library lost its explicit Codex branch');
  const adoptGlobal = expected.get(`${suiteBase}/skills/adopt-global-standards/SKILL.md`);
  const adoptRepo = expected.get(`${suiteBase}/skills/adopt-standards/SKILL.md`);
  expect(adoptGlobal?.includes('`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and `~/.codex/AGENTS.md`'), 'Codex global-standards render collapsed host-specific contract paths');
  expect(adoptRepo?.includes('`CLAUDE.md` and `AGENTS.md`'), 'Codex repo-standards render collapsed the accepted parity modes');
  const marketplace = makeMarketplace();
  expect(marketplace.plugins.length === PLUGINS.length, 'marketplace plugin count does not match renderer registry');
  for (const entry of marketplace.plugins) {
    expect(entry.source.path.startsWith('./codex-marketplace/plugins/'), `${entry.name}: marketplace source path is not rooted in the generated package`);
    expect(entry.policy.installation === 'AVAILABLE' && entry.policy.authentication === 'ON_INSTALL', `${entry.name}: marketplace policy is incomplete`);
  }
}

function compareOutput(expected) {
  const failures = [];
  const actualFiles = new Map();
  for (const file of walkFiles(OUTPUT_ROOT)) actualFiles.set(toPosix(relative(OUTPUT_ROOT, file)), readText(file));
  for (const path of expected.keys()) if (!actualFiles.has(path)) failures.push(`missing generated file: codex-marketplace/${path}`);
  for (const path of actualFiles.keys()) if (!expected.has(path)) failures.push(`unexpected generated file: codex-marketplace/${path}`);
  for (const [path, contents] of expected) if (actualFiles.has(path) && actualFiles.get(path) !== contents) failures.push(`generated file drifted: codex-marketplace/${path}`);
  const marketplaceContents = JSON.stringify(makeMarketplace(), null, 2) + '\n';
  if (!existsSync(MARKETPLACE_PATH)) failures.push('missing generated marketplace: .agents/plugins/marketplace.json');
  else if (readText(MARKETPLACE_PATH) !== marketplaceContents) failures.push('generated marketplace drifted: .agents/plugins/marketplace.json');
  if (failures.length) {
    console.error('FAIL — Codex marketplace is stale. Run: node scripts/build-codex-marketplace.mjs');
    for (const failure of failures.slice(0, 30)) console.error('  x ' + failure);
    if (failures.length > 30) console.error(`  … and ${failures.length - 30} more`);
    process.exit(1);
  }
}

function writeOutput(expected) {
  assertInsideRoot(OUTPUT_ROOT);
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  for (const [relPath, contents] of expected) {
    const path = outputPath(relPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
  mkdirSync(dirname(MARKETPLACE_PATH), { recursive: true });
  writeFileSync(MARKETPLACE_PATH, JSON.stringify(makeMarketplace(), null, 2) + '\n', 'utf8');
}

const expected = buildExpectedFiles();
validateExpectedFiles(expected);
if (CHECK) {
  compareOutput(expected);
  console.log(`OK — Codex marketplace is current (${PLUGINS.length} plugins, ${[...expected.keys()].filter((path) => path.endsWith('/SKILL.md')).length} skills).`);
} else {
  writeOutput(expected);
  console.log(`Built Codex marketplace (${PLUGINS.length} plugins, ${[...expected.keys()].filter((path) => path.endsWith('/SKILL.md')).length} skills).`);
}
