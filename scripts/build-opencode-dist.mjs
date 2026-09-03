#!/usr/bin/env node
// Render and verify the tracked opencode distribution from the canonical Claude source.
//
// WHY: opencode discovers skills, agents, and commands from flat, separate directories
// under a config root — not from a plugin bundle. Its skill names are also restricted to
// `^[a-z0-9]+(-[a-z0-9]+)*$`, so the Claude `plugin:skill` spelling is not expressible and
// the flat namespace collides (`full-sweep` ships in two plugins, `explorer` in two more).
// Hand-maintaining that mapping would let the hosts drift apart silently, so it is rendered
// deterministically and `--check` catches the drift in CI, exactly as the Codex renderer does.
//
//   node scripts/build-opencode-dist.mjs
//   node scripts/build-opencode-dist.mjs --check
//
// Never hand-edit opencode-dist/; change the source package under plugins/ and rerun.
//
// Exit: 0 = written (default mode) or already up to date (--check); 1 = --check found drift
// (stale/missing/unexpected generated file); 2 = usage error. A source-validation failure
// throws and exits non-zero before either mode writes or compares anything.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_ALIAS_TIER, DEFAULT_PROVIDER, PROVIDER_TIERS, REGISTRY_VERIFIED_AT, TIER_ORDER, leadInherits } from './model-tiers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PLUGINS = resolve(ROOT, 'plugins');
const OUTPUT_ROOT = resolve(ROOT, 'opencode-dist');
const CLAUDE_MARKETPLACE_PATH = resolve(ROOT, '.claude-plugin', 'marketplace.json');

// Plugin order is the marketplace order; the renderer validates membership against it.
const PLUGIN_NAMES = ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'];

const ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
const PORTABLE_ROOT = '<plugin-root>';
// opencode's skill-name grammar. A name that cannot satisfy it is never discoverable.
const OPENCODE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPENCODE_NAME_MAX = 64;
const KNOWN_COMMANDS = /\/(code-ops-suite|privacy-opsec-suite|rigor|researcher):([a-z0-9-]+)/g;
const CHECK = process.argv.includes('--check');

if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  console.error('usage: node scripts/build-opencode-dist.mjs [--check]');
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

// The flat opencode namespace has no plugin scoping, so every discoverable name carries
// its plugin as a prefix. This is also what keeps the two `full-sweep` skills and the two
// `explorer` agents from overwriting each other on install.
function qualify(pluginName, slug) {
  return `${pluginName}-${slug}`;
}

function assertDiscoverableName(name, what) {
  if (!OPENCODE_NAME_RE.test(name)) throw new Error(`${what}: "${name}" does not match opencode's name grammar ${OPENCODE_NAME_RE}`);
  if (name.length > OPENCODE_NAME_MAX) throw new Error(`${what}: "${name}" is ${name.length} characters, over opencode's ${OPENCODE_NAME_MAX}-character limit`);
}

function portableText(contents) {
  return contents
    .replaceAll(ROOT_TOKEN, PORTABLE_ROOT)
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('Claude Code', 'opencode')
    // Claude slash spelling -> opencode's command spelling (no colons in command names).
    .replace(KNOWN_COMMANDS, (_match, plugin, skill) => `/${qualify(plugin, skill)}`);
}

function parseFrontmatter(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${path}: expected YAML frontmatter bounded by ---`);
  return { header: match[1].split('\n'), body: match[2] };
}

function fieldValue(header, key, path) {
  const line = header.find((entry) => entry.startsWith(`${key}:`));
  if (!line) throw new Error(`${path}: frontmatter is missing ${key}`);
  const raw = line.slice(key.length + 1).trim();
  if (!raw) throw new Error(`${path}: frontmatter ${key} must not be blank`);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return raw;
}

// Descriptions are prose too: rigor/verifier names a bundled script path in its own
// description, so the host transforms have to reach frontmatter values, not just bodies.
function portableField(header, key, path) {
  return portableText(fieldValue(header, key, path));
}

function yamlString(value) {
  return JSON.stringify(value);
}

function transformSkill(pluginName, slug, contents, path) {
  const { header, body } = parseFrontmatter(contents, path);
  const description = portableField(header, 'description', path);
  const name = qualify(pluginName, slug);
  assertDiscoverableName(name, `${pluginName}/${slug}`);

  const marker = `**Invoked as \`/${pluginName}:${slug}\`.**`;
  if (!body.includes(marker)) throw new Error(`${path}: expected invocation marker ${marker}`);
  const rule = [
    `**opencode path rule:** Resolve \`${PORTABLE_ROOT}\` as \`code-ops/${pluginName}/\` inside your opencode config directory (the directory holding this plugin's \`CONVENTIONS.md\`); use it for every bundled script or reference path.`,
    '',
    `**Invoked as \`/${name}\`, or by the model through the \`skill\` tool as \`${name}\`.**`,
  ].join('\n');

  const transformed = portableText(body.replace(marker, rule));
  return ['---', `name: ${name}`, `description: ${yamlString(description)}`, '---', transformed].join('\n');
}

// Claude declares an agent's capability as a `tools:` allowlist; opencode declares it as a
// `permission:` map. Translating rather than dropping it is what keeps the read-only
// operatives actually read-only on this host.
function permissionsForTools(toolList) {
  const tools = new Set(toolList.split(',').map((entry) => entry.trim()).filter(Boolean));
  const canEdit = tools.has('Write') || tools.has('Edit');
  const canRunShell = tools.has('Bash');
  return [
    'permission:',
    `  edit: ${canEdit ? 'allow' : 'deny'}`,
    `  bash: ${canRunShell ? 'allow' : 'deny'}`,
    '  webfetch: deny',
  ];
}

function transformAgent(pluginName, contents, path) {
  const { header, body } = parseFrontmatter(contents, path);
  const sourceName = fieldValue(header, 'name', path);
  const description = portableField(header, 'description', path);
  const tools = fieldValue(header, 'tools', path);
  const alias = fieldValue(header, 'model', path);
  const tier = CLAUDE_ALIAS_TIER[alias];
  if (!tier) throw new Error(`${path}: model "${alias}" is not a known tier alias`);

  const name = qualify(pluginName, sourceName);
  assertDiscoverableName(name, `${pluginName}/${sourceName}`);

  return [
    '---',
    `description: ${yamlString(description)}`,
    'mode: subagent',
    ...permissionsForTools(tools),
    '---',
    '',
    `> **Required capability tier: \`${tier}\`.** Bind this agent to a model that meets it — see \`MODEL_TIERS.md\` for the per-provider bindings. opencode has no per-plugin model floor, so this line is the floor's only carrier on this host; the gate that enforces it lives in the source repository.`,
    '',
    portableText(body).trim(),
    '',
  ].join('\n');
}

function commandFile(pluginName, slug, description) {
  const name = qualify(pluginName, slug);
  return [
    '---',
    `description: ${yamlString(description)}`,
    '---',
    '',
    `Use the \`${name}\` skill for this task, following it end to end.`,
    '',
    'Additional context or scope from the caller (may be empty):',
    '',
    '$ARGUMENTS',
    '',
  ].join('\n');
}

function tracelessPlugin() {
  return `// opencode port of the traceless-publishing PreToolUse gate.
//
// WHY: the canonical Claude hook (plugins/code-ops-suite/hooks/enforce-traceless.mjs) is a
// stdin/exit-code contract that opencode does not speak. opencode plugins subscribe to
// \`tool.execute.before\` and block a call by throwing, so the gate is ported rather than
// copied. The policy is identical: scan a commit / PR-open / PR-merge shell command for
// AI or tooling trace with the bundled scan-ai-tells.mjs, block on a hit, and fail OPEN on
// any scanner infrastructure failure — CI (\`scan-ai-tells.mjs --git <range>\`) is the
// fail-closed backstop that this hook only shortens the feedback loop for.
//
// Install: copy to <opencode config dir>/plugins/. It resolves the scanner relative to its
// own location, so keep the distribution layout intact.

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A commit/PR-open/-merge invocation, tolerant of \`git -C <dir>\` / \`git --flag=val\`
// prefixes ahead of the subcommand. Anything else is out of scope for this gate.
const GATED_RE = /\\bgit(?:\\s+-[Cc]\\s+\\S+|\\s+--\\S+=\\S+)*\\s+commit\\b|\\bgh\\s+pr\\s+(?:create|merge)\\b/i;

const SCANNER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'code-ops',
  'code-ops-suite',
  'scripts',
  'scan-ai-tells.mjs',
);

export const CodeOpsTraceless = async () => ({
  'tool.execute.before': async (input, output) => {
    if (input?.tool !== 'bash') return;
    const command = output?.args?.command;
    if (typeof command !== 'string') return;
    if (!GATED_RE.test(command)) return; // fast path: no fs/spawn for the common case

    const tmpFile = join(tmpdir(), \`traceless-hook-\${randomUUID()}.txt\`);
    let report = null;
    try {
      writeFileSync(tmpFile, command, 'utf8');
      execFileSync(process.execPath, [SCANNER, tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // The scanner ran and found hits (exit 1). Anything else — ENOENT, permissions — is
      // an infrastructure failure, and this gate fails open on those by design.
      if (typeof e.status === 'number') report = (e.stdout ?? '').toString();
    } finally {
      try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
    }

    if (report !== null) {
      throw new Error(
        'Traceless gate: AI-tell in commit/PR command.\\n' +
          report +
          '\\nRewrite the message without the flagged content. If the hit is in a non-message ' +
          'part of a compound command, run the commit as its own command.',
      );
    }
  },
});
`;
}

function modelTiersDoc(agents) {
  const providers = Object.values(PROVIDER_TIERS);
  const lines = [
    '# Model tiers',
    '',
    'Generated by `scripts/build-opencode-dist.mjs`. Do not edit.',
    '',
    'The suite routes operative work by capability tier, not by model name. The ladder is',
    'provider-agnostic — `frontier > strong > mid > light` — so any host can tell which of its',
    'models satisfies an agent’s floor. That is what makes the orchestration doctrine portable:',
    'the briefs, the fan-out rules, and the verification bar are identical everywhere, and only',
    'this table changes between providers.',
    '',
    `Model ids are pinned, verified against the models.dev registry on ${REGISTRY_VERIFIED_AT}, except a`,
    'provider marked as verified against its host CLI, whose ids come from `opencode models` on the date its',
    'entry records. Re-verify with `node scripts/check-model-registry.mjs --fetch` in the source repository.',
    '',
    '## Tier bindings',
    '',
    `| Provider | ${TIER_ORDER.map((tier) => `\`${tier}\``).join(' | ')} |`,
    `| --- | ${TIER_ORDER.map(() => '---').join(' | ')} |`,
    ...providers.map((p) => `| ${p.label} | ${TIER_ORDER.map((tier) => (p.models[tier] === null ? 'session model (lead unset)' : `\`${p.id}/${p.models[tier]}\``)).join(' | ')} |`),
    '',
    'Where a provider repeats a model across two rungs, its lineup has no distinct model for',
    'the lower one. The collapse is recorded rather than papered over with an invented tier.',
    '',
    '## Provider notes',
    '',
    ...providers.map((p) => `- **${p.label}** — ${p.notes}`),
    '',
    '## Ready-made configs',
    '',
    'One config per provider ships under `configs/`, each binding every agent to its tier:',
    '',
    ...providers.map((p) => `- \`configs/opencode.${p.id}.json\``),
    '',
    `\`opencode.json\` at the root is a copy of the \`${DEFAULT_PROVIDER}\` one, which costs nothing and leaves the lead`,
    'unset so it inherits the session model. Merge whichever you want into your own config rather',
    'than overwriting a config you already have, and keep your own copy out of a refresh.',
    '',
    '## Agent floors',
    '',
    'Each bundled agent states its required tier in its own file. For reference:',
    '',
    '| Agent | Required tier |',
    '| --- | --- |',
    ...agents.map((agent) => `| \`${agent.name}\` | \`${agent.tier}\` |`),
    '',
    'Reasoning effort is a separate dial and routes by ambiguity, not by tier: low for',
    'mechanical work, medium for implementation and verification execution, high for review.',
    'The major providers expose the same low/medium/high/xhigh scale, so the effort doctrine',
    'transfers unchanged alongside the tier table.',
    '',
  ];
  return lines.join('\n');
}

function exampleConfig(agents, providerId) {
  const provider = PROVIDER_TIERS[providerId];
  return {
    $schema: 'https://opencode.ai/config.json',
    // No top-level model when the provider leaves the lead unset: the lead inherits the session model.
    ...(leadInherits(provider) ? {} : { model: `${provider.id}/${provider.models.frontier}` }),
    agent: Object.fromEntries(
      agents.map((agent) => [agent.name, { model: `${provider.id}/${provider.models[agent.tier]}` }]),
    ),
    permission: {
      // The traceless plugin gates commit/PR-publishing commands, but it only shortens the
      // feedback loop. Asking before a shell command keeps the developer in the loop, which
      // is the interaction protocol every skill in this suite assumes.
      bash: { 'git push *': 'ask', 'gh pr *': 'ask' },
    },
  };
}

function generatedReadme(skills, agents) {
  return [
    '# Generated opencode distribution',
    '',
    'This directory is generated from the canonical packages under `../plugins/` by',
    '`node scripts/build-opencode-dist.mjs`. Do not edit files here directly; change the',
    'source package and rerun the renderer.',
    '',
    '## Install',
    '',
    'Copy the contents into your opencode config directory — `~/.config/opencode/` for a',
    'global install, or `.opencode/` inside a repository for a project-local one:',
    '',
    '```bash',
    'cp -R opencode-dist/. ~/.config/opencode/',
    '```',
    '',
    'The layout is deliberate. `plugins/code-ops-traceless.js` resolves its scanner through',
    '`../code-ops/code-ops-suite/scripts/`, so moving directories apart breaks the gate.',
    '',
    '## What lands where',
    '',
    `- \`skills/\` — ${skills.length} skills, discovered by the model through opencode's \`skill\` tool.`,
    `- \`commands/\` — ${skills.length} slash commands, one per skill, for user invocation.`,
    `- \`agents/\` — ${agents.length} subagents, with their Claude tool allowlists translated to opencode permissions.`,
    '- `code-ops/` — per-plugin `CONVENTIONS.md` and the runtime scripts the skills invoke.',
    '- `plugins/` — the traceless-publishing gate, ported to an opencode plugin hook.',
    '- `opencode.json` — an example config binding every agent to its tier. Merge it into',
    '  your own config rather than overwriting one you already have.',
    '',
    '## Naming',
    '',
    "opencode's skill and agent namespaces are flat and its names cannot contain a colon, so",
    'every name is prefixed with its plugin: `/code-ops-suite:ship` becomes `/code-ops-suite-ship`.',
    'The prefix is load-bearing — `full-sweep` ships in two plugins and `explorer` in two more.',
    '',
    'See `MODEL_TIERS.md` for model bindings and `PLATFORM_COMPATIBILITY.md` for the full',
    'list of host transforms.',
    '',
  ].join('\n');
}

function compatibilityNotes() {
  return [
    '# Platform compatibility',
    '',
    'This opencode package is generated from the repository’s canonical Claude package.',
    'Rebuild it with `node scripts/build-opencode-dist.mjs`; CI uses `--check` to prevent drift.',
    '',
    '## Deliberate host transforms',
    '',
    '- **Names are plugin-prefixed.** opencode discovers skills and agents into one flat',
    '  namespace and its name grammar (`^[a-z0-9]+(-[a-z0-9]+)*$`) has no colon, so',
    '  `code-ops-suite:ship` renders as `code-ops-suite-ship`. Without the prefix the two',
    '  `full-sweep` skills and the two `explorer` agents would collide on install.',
    '- **Skills and commands are both generated.** A skill is model-invocable through',
    "  opencode's `skill` tool; a command is the user-facing slash entry point that names it.",
    '  Claude Code collapses both into one surface, opencode does not.',
    '- **`${CLAUDE_PLUGIN_ROOT}` becomes `<plugin-root>`,** resolved as',
    '  `code-ops/<plugin>/` inside the opencode config directory. opencode has no',
    '  plugin-root token because it has no plugin bundle for skills.',
    '- **Agent `tools:` becomes `permission:`.** A Claude allowlist without `Write`/`Edit`',
    '  renders `edit: deny`, and one without `Bash` renders `bash: deny`, so read-only',
    '  operatives stay read-only. `webfetch` is denied for every agent, matching the suite’s',
    '  local-first egress stance.',
    '- **Agent `model:` becomes a stated capability tier.** opencode resolves models per',
    '  provider, so a hardcoded Anthropic alias would not bind. Each agent states its',
    '  required tier and `MODEL_TIERS.md` gives the per-provider model for it. The',
    '  lint-enforced floor lives in the source repository; this host carries the tier as',
    '  documentation, not as a gate.',
    '- **The traceless hook is ported, not copied.** Claude’s `PreToolUse` hook is a',
    '  stdin/exit-code contract; the opencode plugin subscribes to `tool.execute.before` and',
    '  throws to block. Same policy, same fail-open-on-infrastructure-error stance.',
    '- **The `code-ops-docs` MCP server is not bundled.** opencode configures MCP servers in',
    '  `opencode.json` rather than per plugin; add it there if you want it.',
    '- **Claude GitHub Action examples are omitted** because they are not opencode runtime',
    '  configuration.',
    '',
  ].join('\n');
}

function buildExpectedFiles() {
  const marketplace = JSON.parse(readText(CLAUDE_MARKETPLACE_PATH));
  const canonicalNames = marketplace.plugins.map((entry) => entry.name).sort();
  if (JSON.stringify(canonicalNames) !== JSON.stringify([...PLUGIN_NAMES].sort())) {
    throw new Error(`${CLAUDE_MARKETPLACE_PATH}: plugin membership must match the opencode renderer registry (canonical: ${canonicalNames.join(', ')}; renderer: ${[...PLUGIN_NAMES].sort().join(', ')})`);
  }

  const out = new Map();
  const add = (path, contents) => {
    const key = toPosix(path);
    if (out.has(key)) throw new Error(`renderer produced duplicate path ${key} — a plugin prefix is not disambiguating`);
    out.set(key, contents);
  };

  const skills = [];
  const agents = [];

  for (const pluginName of PLUGIN_NAMES) {
    const skillsDir = sourcePath(pluginName, 'skills');
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of skillDirs) {
      const skillPath = sourcePath(pluginName, 'skills', entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) throw new Error(`${skillPath}: missing skill file`);
      const contents = readText(skillPath);
      const description = portableField(parseFrontmatter(contents, skillPath).header, 'description', skillPath);
      const name = qualify(pluginName, entry.name);
      skills.push({ name, plugin: pluginName, slug: entry.name, description });
      add(`skills/${name}/SKILL.md`, transformSkill(pluginName, entry.name, contents, skillPath));
      add(`commands/${name}.md`, commandFile(pluginName, entry.name, description));
    }

    const agentsDir = sourcePath(pluginName, 'agents');
    if (existsSync(agentsDir)) {
      for (const file of walkFiles(agentsDir)) {
        if (!file.endsWith('.md')) continue;
        const contents = readText(file);
        const header = parseFrontmatter(contents, file).header;
        const name = qualify(pluginName, fieldValue(header, 'name', file));
        agents.push({ name, tier: CLAUDE_ALIAS_TIER[fieldValue(header, 'model', file)] });
        add(`agents/${name}.md`, transformAgent(pluginName, contents, file));
      }
    }

    add(`code-ops/${pluginName}/CONVENTIONS.md`, portableText(readText(sourcePath(pluginName, 'CONVENTIONS.md'))));
    for (const file of walkFiles(sourcePath(pluginName, 'scripts'))) {
      add(`code-ops/${pluginName}/scripts/${toPosix(relative(sourcePath(pluginName, 'scripts'), file))}`, readText(file));
    }
  }

  add('plugins/code-ops-traceless.js', tracelessPlugin());
  add('MODEL_TIERS.md', modelTiersDoc(agents));
  add('PLATFORM_COMPATIBILITY.md', compatibilityNotes());
  add('README.md', generatedReadme(skills, agents));
  // One config per provider: the whole point of the tier ladder is that moving the suite to
  // another provider is a config swap, not a rewrite. The root file copies the default one.
  for (const providerId of Object.keys(PROVIDER_TIERS)) {
    add(`configs/opencode.${providerId}.json`, JSON.stringify(exampleConfig(agents, providerId), null, 2) + '\n');
  }
  add('opencode.json', JSON.stringify(exampleConfig(agents, DEFAULT_PROVIDER), null, 2) + '\n');
  return { files: out, skills, agents };
}

function expect(condition, message) {
  if (!condition) throw new Error(`opencode package validation: ${message}`);
}

function validate({ files, skills, agents }) {
  expect(skills.length > 0, 'no skills were rendered');
  expect(agents.length > 0, 'no agents were rendered');

  for (const skill of skills) {
    const path = `skills/${skill.name}/SKILL.md`;
    const contents = files.get(path);
    expect(contents !== undefined, `${path} is missing`);
    expect(contents.startsWith(`---\nname: ${skill.name}\n`), `${path} does not declare its opencode skill name`);
    expect(!contents.includes(ROOT_TOKEN), `${path} retains the Claude plugin-root token`);
    expect(contents.includes(PORTABLE_ROOT), `${path} did not translate the plugin root token`);
    expect(!/`\/[a-z-]+:[a-z-]+`/.test(contents), `${path} retains a Claude colon-spelled slash command`);
    const command = `commands/${skill.name}.md`;
    expect(files.has(command), `${command} is missing`);
    expect(files.get(command).includes(`\`${skill.name}\` skill`), `${command} does not name its skill`);
  }

  for (const agent of agents) {
    const path = `agents/${agent.name}.md`;
    const contents = files.get(path);
    expect(contents !== undefined, `${path} is missing`);
    expect(contents.includes('mode: subagent'), `${path} does not declare opencode subagent mode`);
    expect(/^permission:$/m.test(contents), `${path} does not translate the Claude tool allowlist to permissions`);
    expect(!/^tools:/m.test(contents), `${path} retains Claude-only tools frontmatter`);
    expect(!/^model:/m.test(contents), `${path} retains a Claude-only model alias`);
    expect(contents.includes(`Required capability tier: \`${agent.tier}\``), `${path} does not state its capability tier`);
    expect(!contents.includes(ROOT_TOKEN), `${path} retains the Claude plugin-root token`);
  }

  const plugin = files.get('plugins/code-ops-traceless.js');
  expect(plugin.includes("'tool.execute.before'"), 'the traceless plugin does not subscribe to tool.execute.before');
  expect(plugin.includes("input?.tool !== 'bash'"), 'the traceless plugin does not gate the bash tool');
  expect(plugin.includes('throw new Error('), 'the traceless plugin cannot block a call');
  expect(files.has('code-ops/code-ops-suite/scripts/scan-ai-tells.mjs'), 'the traceless plugin has no scanner to resolve');

  const config = JSON.parse(files.get('opencode.json'));
  for (const agent of agents) {
    expect(typeof config.agent?.[agent.name]?.model === 'string', `opencode.json does not bind a model for ${agent.name}`);
  }
  const tiers = files.get('MODEL_TIERS.md');
  for (const provider of Object.values(PROVIDER_TIERS)) {
    for (const tier of TIER_ORDER) {
      if (provider.models[tier] === null) { expect(tiers.includes('session model (lead unset)'), `MODEL_TIERS.md must say the ${provider.id} lead is unset`); continue; }
      expect(tiers.includes(`\`${provider.id}/${provider.models[tier]}\``), `MODEL_TIERS.md is missing the ${provider.id} binding for ${tier}`);
    }
    // Every provider must be independently usable, or "supports N providers" is a claim the
    // package does not back: a reader on that provider needs a config they can copy.
    const perProvider = `configs/opencode.${provider.id}.json`;
    expect(files.has(perProvider), `${perProvider} is missing`);
    const parsed = JSON.parse(files.get(perProvider));
    for (const agent of agents) {
      expect(parsed.agent?.[agent.name]?.model === `${provider.id}/${provider.models[agent.tier]}`, `${perProvider} does not bind ${agent.name} to its ${agent.tier}-tier model`);
    }
  }
}

function compareOutput(expected) {
  const failures = [];
  const actualFiles = new Map();
  for (const file of walkFiles(OUTPUT_ROOT)) actualFiles.set(toPosix(relative(OUTPUT_ROOT, file)), readText(file));
  for (const path of expected.keys()) if (!actualFiles.has(path)) failures.push(`missing generated file: opencode-dist/${path}`);
  for (const path of actualFiles.keys()) if (!expected.has(path)) failures.push(`unexpected generated file: opencode-dist/${path}`);
  for (const [path, contents] of expected) if (actualFiles.has(path) && actualFiles.get(path) !== contents) failures.push(`generated file drifted: opencode-dist/${path}`);
  if (failures.length) {
    console.error('FAIL — opencode distribution is stale. Run: node scripts/build-opencode-dist.mjs');
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
}

const rendered = buildExpectedFiles();
validate(rendered);
const summary = `${PLUGIN_NAMES.length} plugins, ${rendered.skills.length} skills, ${rendered.agents.length} agents`;
if (CHECK) {
  compareOutput(rendered.files);
  console.log(`OK — opencode distribution is current (${summary}).`);
} else {
  writeOutput(rendered.files);
  console.log(`Built opencode distribution (${summary}).`);
}
