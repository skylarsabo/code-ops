#!/usr/bin/env node
// Render and verify the tracked Codex distribution from the canonical Claude source.
//
//   node scripts/build-codex-marketplace.mjs
//   node scripts/build-codex-marketplace.mjs --check
//
// The hosts require incompatible skill headers: Claude's source stays manual-invoke
// while this renderer gives Codex each skill a `name` plus an explicit no-implicit-
// invocation policy. Never hand-edit codex-marketplace/; use this script instead.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function portableText(contents) {
  return contents
    .replaceAll(ROOT_TOKEN, '<plugin-root>')
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('Claude Code', 'Codex')
    .replace(KNOWN_COMMANDS, '$1:$2');
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
  transformed = portableText(transformed);
  return `---\nname: ${slug}\n${keptHeader.join('\n')}\n---\n${transformed}`;
}

function transformAgent(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${path}: expected YAML frontmatter bounded by ---`);
  const header = match[1].split('\n').filter((line) => !/^(tools|model):/.test(line)).map(portableText);
  const body = portableText(match[2]);
  return [
    '---',
    ...header,
    '---',
    '',
    '> Codex role contract: this file is a briefing template for a collaboration subagent; it is not auto-discovered as a Claude agent. The lead chooses available model/runtime routing.',
    '',
    body,
  ].join('\n');
}

function skillAgentYaml(pluginName, slug, description) {
  return [
    'interface:',
    `  display_name: ${JSON.stringify(titleCase(slug))}`,
    `  short_description: ${JSON.stringify(description)}`,
    `  default_prompt: ${JSON.stringify(`Use ${pluginName}:${slug} for this task.`)}`,
    'policy:',
    '  allow_implicit_invocation: false',
    '',
  ].join('\n');
}

function generatedReadme(spec, manifest, skills) {
  const lines = [
    `# ${spec.displayName} for Codex`,
    '',
    '> Generated by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.',
    '',
    manifest.description,
    '',
    '## Use',
    '',
    `Name a workflow in Codex as \`${spec.name}:<skill>\`. Every generated skill sets \`policy.allow_implicit_invocation: false\`, preserving the source package's manual-invocation policy.`,
    '',
    '## Skills',
    '',
    ...skills.map((skill) => `- \`${skill.slug}\` — ${skill.description}`),
    '',
    '## Packaging notes',
    '',
    '- The complete workflow text and conventions are rendered from `plugins/' + spec.name + '/` in the source repository.',
    '- Claude-specific GitHub Action examples are intentionally not bundled here.',
    '- Root-level `agents/*.md` files are collaboration-subagent briefing templates; Codex does not auto-discover them as Claude agents.',
  ];
  if (spec.mcp) lines.push('- `code-ops-docs` is bundled as an optional, plugin-scoped MCP server.');
  if (existsSync(sourcePath(spec.name, 'hooks', 'hooks.json'))) {
    lines.push('- The traceless-publishing hook is bundled. Codex requires the user to review and trust plugin hooks before they run.');
  }
  lines.push('', 'For source history and release notes, see the generated `CHANGELOG.md` and the repository root.', '');
  return lines.join('\n');
}

function compatibilityNotes(spec) {
  const lines = [
    '# Platform compatibility',
    '',
    'This Codex package is generated from the repository’s canonical Claude package. Rebuild it with `node scripts/build-codex-marketplace.mjs`; CI uses `--check` to prevent drift.',
    '',
    '## Deliberate host transforms',
    '',
    '- Claude skill headers use `disable-model-invocation: true`; Codex requires a skill `name`. This render removes the Claude-only field and writes `skills/<skill>/agents/openai.yaml` with `policy.allow_implicit_invocation: false` to keep manual invocation.',
    '- `${CLAUDE_PLUGIN_ROOT}` becomes `<plugin-root>` in instructional prose. Codex resolves bundled runtime paths from the installed plugin root.',
    '- Claude slash-command spelling becomes the Codex named-workflow spelling, for example `code-ops-suite:codebase-audit`.',
    '- Claude agent `tools` and `model` frontmatter is removed. The root `agents/` files remain role-briefing templates for collaboration subagents.',
    '- Claude GitHub Action examples are omitted because they are not Codex runtime configuration.',
  ];
  if (existsSync(sourcePath(spec.name, 'hooks', 'hooks.json'))) {
    lines.push('- The `PreToolUse` traceless-publishing hook is retained as `hooks/hooks.json`. Codex skips plugin hooks until the user reviews and trusts the hook definition.');
  }
  if (spec.mcp) lines.push('- The `code-ops-docs` MCP declaration is translated from Claude’s inline manifest entry to Codex `.mcp.json` with a plugin-root-relative script path.');
  lines.push('', 'The generated package must continue to pass the Codex plugin validator and marketplace install smoke test.', '');
  return lines.join('\n');
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

function createMcpConfig() {
  return {
    mcpServers: {
      'code-ops-docs': {
        command: 'node',
        args: ['./scripts/lib-docs-mcp.mjs'],
        cwd: '.',
      },
    },
  };
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
    add(`${base}/PLATFORM_COMPATIBILITY.md`, compatibilityNotes(spec));
    add(`${base}/CONVENTIONS.md`, portableText(readText(sourcePath(spec.name, 'CONVENTIONS.md'))));
    add(`${base}/CHANGELOG.md`, portableText(readText(sourcePath(spec.name, 'CHANGELOG.md'))).replace('`.claude-plugin/plugin.json` and the matching entry in the marketplace.', 'the source plugin manifest and matching marketplace entries.'));
    addSourceTree(sourcePath(spec.name, 'scripts'), `${base}/scripts`);

    const sourceAgents = sourcePath(spec.name, 'agents');
    if (existsSync(sourceAgents)) addSourceTree(sourceAgents, `${base}/agents`, transformAgent);

    const sourceHooks = sourcePath(spec.name, 'hooks');
    if (existsSync(sourceHooks)) {
      addSourceTree(sourceHooks, `${base}/hooks`, (contents) => contents.replaceAll(ROOT_TOKEN, CODEX_ROOT_TOKEN));
    }
    if (spec.mcp) add(`${base}/.mcp.json`, JSON.stringify(createMcpConfig(), null, 2) + '\n');
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
      expect(expected.get(policyPath).includes('allow_implicit_invocation: false'), `${policyPath} does not preserve manual invocation`);
    }
    if (existsSync(sourcePath(spec.name, 'hooks', 'hooks.json'))) {
      const hookPath = `${base}/hooks/hooks.json`;
      expect(expected.has(hookPath), `${hookPath} is missing`);
      expect(expected.get(hookPath).includes(CODEX_ROOT_TOKEN), `${hookPath} does not use PLUGIN_ROOT`);
    }
  }
  for (const [path, contents] of expected) {
    if (/(?:\/SKILL\.md|\/agents\/[^/]+\.md|\/CONVENTIONS\.md)$/.test(path)) {
      expect(!contents.includes(ROOT_TOKEN), `${path} retains the Claude plugin-root token`);
    }
  }
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
