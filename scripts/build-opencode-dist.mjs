#!/usr/bin/env node
// Render and verify the tracked opencode distribution from the canonical Claude source.
//
// WHY: opencode discovers skills, agents, and commands from flat, separate directories
// under a config root — not from a plugin bundle. Its skill names are also restricted to
// `^[a-z0-9]+(-[a-z0-9]+)*$`, so the Claude `plugin:skill` spelling is not expressible and
// the flat namespace collides (`explorer` ships as an agent in two plugins).
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
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTED_MODELS, CLAUDE_ALIAS_TIER, DEFAULT_PROVIDER, PROVIDER_PRICES, PROVIDER_SPECIALISTS, PROVIDER_TIERS, REGISTRY_VERIFIED_AT, TIER_ORDER, leadInherits, modelSupportsTier } from './model-tiers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PLUGINS = resolve(ROOT, 'plugins');
// The test harness renders into a disposable directory under evals/ so it can prove the
// complete package without mutating the tracked distribution. Production invocations keep
// using opencode-dist/. Do not point this outside the repository: writeOutput removes its
// target before rebuilding it.
const OUTPUT_OVERRIDE = process.env.CODE_OPS_OPENCODE_OUTPUT_ROOT;
const OUTPUT_ROOT = resolve(OUTPUT_OVERRIDE ?? resolve(ROOT, 'opencode-dist'));
if (OUTPUT_OVERRIDE) {
  const evalRoot = resolve(ROOT, 'evals', 'opencode-dist');
  const rel = relative(evalRoot, OUTPUT_ROOT);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !rel.split(sep)[0].startsWith('.render-')) {
    throw new Error('CODE_OPS_OPENCODE_OUTPUT_ROOT must be a .render-* child of evals/opencode-dist');
  }
}
const CLAUDE_MARKETPLACE_PATH = resolve(ROOT, '.claude-plugin', 'marketplace.json');

// Plugin order is the marketplace order; the renderer validates membership against it.
const PLUGIN_NAMES = ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'];

const ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
const PORTABLE_ROOT = '<plugin-root>';
// opencode's skill-name grammar. A name that cannot satisfy it is never discoverable.
const OPENCODE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPENCODE_NAME_MAX = 64;
// Canonical skill prose uses both `/plugin:skill` and bare `plugin:skill` references.
// OpenCode accepts neither colon form, so rewrite both rather than leaving an uncallable
// reference behind in a rendered skill.
const KNOWN_SKILL_REFS = /(^|[^a-z0-9-])\/?(code-ops-suite|privacy-opsec-suite|rigor|researcher):([a-z0-9-]+)\b/gm;
const RESIDUAL_SKILL_REF = /\b(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):[a-z0-9-]+\b/;
const CLAUDE_CONTRACT_SENTINEL = '__CODE_OPS_CLAUDE_CONTRACT__';
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
// its plugin as a prefix. This is also what keeps the two `explorer` agents from
// overwriting each other on install.
function qualify(pluginName, slug) {
  return `${pluginName}-${slug}`;
}

function assertDiscoverableName(name, what) {
  if (!OPENCODE_NAME_RE.test(name)) throw new Error(`${what}: "${name}" does not match opencode's name grammar ${OPENCODE_NAME_RE}`);
  if (name.length > OPENCODE_NAME_MAX) throw new Error(`${what}: "${name}" is ${name.length} characters, over opencode's ${OPENCODE_NAME_MAX}-character limit`);
}

function portableText(contents, { preservePairedContracts = false } = {}) {
  let guarded = contents;
  if (preservePairedContracts) {
    guarded = guarded.split('\n').map((line) => line.includes('CLAUDE.md') && line.includes('AGENTS.md')
      ? line.replaceAll('CLAUDE.md', CLAUDE_CONTRACT_SENTINEL)
      : line).join('\n');
  }
  return guarded
    .replaceAll(ROOT_TOKEN, PORTABLE_ROOT)
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('Claude Code', 'opencode')
    // Claude spellings -> OpenCode's command spelling (no colons in command names).
    .replace(KNOWN_SKILL_REFS, (_match, prefix, plugin, skill) => `${prefix}/${qualify(plugin, skill)}`)
    .replaceAll(CLAUDE_CONTRACT_SENTINEL, 'CLAUDE.md');
}

function routingCardText() {
  return portableText(execFileSync(process.execPath, [sourcePath('code-ops-suite', 'hooks', 'routing-card.mjs')], { encoding: 'utf8' }).trim());
}

function transformConventions(contents) {
  const portable = portableText(contents);
  return portable.replace(
    /^\*\*Context economy runs under the session, not under a skill\.\*\*.*$/m,
    '**OpenCode runtime limits.** This distribution runs traceless publishing, model-floor enforcement, digest rewrite, index refresh, routing guidance, compaction preservation, the lifecycle plugin, and local documentation MCP registration. `CODE_OPS_DIGEST`, `CODE_OPS_INDEX`, `CODE_OPS_LADDER_CARD`, `CODE_OPS_HANDOFF_CARD`, `CODE_OPS_HANDOFF_PICKUP`, `CODE_OPS_DISPATCH_GUARD`, `CODE_OPS_RECEIPTS`, and `CODE_OPS_COST_LEDGER` are process-environment switches, and `CODE_OPS_CONTEXT_CEILING` moves or disables the dispatch guard’s context ceiling. The lifecycle plugin keeps one stable system prefix and carries handoff and dispatch notes on the next tool result or user turn. Past the ceiling it denies a new Task dispatch until the handoff skill or command runs.',
  ).replace(
    /^Where `code-ops-suite` is installed beside this plugin, its (?:supported )?session mechanisms run under the same session[.:].*$/m,
    '**OpenCode sibling runtime.** Where `code-ops-suite` is installed beside this plugin, its OpenCode adapters provide digest rewrite, symbol-index refresh, routing guidance, compaction preservation, and the lifecycle plugin. `CODE_OPS_DIGEST` and `CODE_OPS_INDEX` are process-environment switches; routing and compaction have no off switch. The lifecycle plugin covers the ladder card, the handoff note, the dispatch guard, and the cost ledger for the whole host. The adapters remain local and make no network request.',
  );
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
    '',
    '**OpenCode runtime note:** Traceless publishing, model-floor enforcement, digest rewrite, index refresh, routing guidance, compaction preservation, the lifecycle plugin, and local documentation MCP registration run automatically. The lifecycle plugin keeps a stable system prefix and writes the cost ledger. Handoff and dispatch notes ride on the next tool result or user turn.',
  ].join('\n');

  const transformed = portableText(body.replace(marker, rule), {
    preservePairedContracts: pluginName === 'code-ops-suite' && slug === 'conform',
  });
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
    `> **Required capability tier: \`${tier}\`.** Bind this agent to a model that meets it — see \`MODEL_TIERS.md\` for the per-provider bindings. The generated model-floor plugin blocks a known below-floor or unclassified provider/model binding for this agent.`,
    '',
    portableText(body).trim(),
    '',
  ].join('\n');
}

// The canonical preflight script deliberately reads `name` and `model` from nearby agent
// frontmatter. OpenCode discovers operative agents only from its top-level agents/ directory,
// so carry a small, non-discoverable manifest beside each vendored preflight script as well.
// This keeps the portable preflight's existing tier report useful without exposing Claude
// frontmatter to the OpenCode agent loader.
function floorCarrierAgent(contents, path) {
  const { header } = parseFrontmatter(contents, path);
  const name = fieldValue(header, 'name', path);
  const model = fieldValue(header, 'model', path);
  return [
    '---',
    `name: ${name}`,
    `model: ${model}`,
    '---',
    '',
    'Generated tier-floor carrier for the vendored preflight script. Not an OpenCode agent.',
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
// copied. The policy is identical: scan a commit / PR-open / PR-merge shell command with
// the bundled scan-ai-tells.mjs in --command mode, which covers the raw command and each
// message, trailer, title, and body argument value it would publish. Block on a hit, and
// fail OPEN when the scanner cannot spawn, because the "Traceless publishing (PR commits,
// title, body)" CI step is the fail-closed backstop on every pull request.
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
      execFileSync(process.execPath, [SCANNER, '--command', tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
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

// OpenCode's installed plugin types expose `chat.params` with the selected agent and the
// resolved `{ providerID, id }` model. That is the one point where a declared agent floor can
// be checked before an operative runs. Keep the model table generated from model-tiers.mjs so
// the check and every ready-made provider config have one source of truth.
function modelFloorPlugin(agents, routingCard) {
  const required = Object.fromEntries(agents.map((agent) => [agent.name, agent.tier]));
  const rank = Object.fromEntries(TIER_ORDER.map((tier, index) => [tier, index]));
  const knownModels = {};
  const tierById = {};
  const consider = (providerId, model, tier) => {
    if (model === null || model === undefined) return;
    if (providerId) {
      knownModels[providerId] ??= {};
      if (knownModels[providerId][model] === undefined || rank[tier] > rank[knownModels[providerId][model]]) {
        knownModels[providerId][model] = tier;
      }
    }
    // A provider can reuse one model across rungs. The bare id satisfies the highest rung
    // carrying it, so a reseller provider keeps that verified tier.
    if (tierById[model] === undefined || rank[tier] > rank[tierById[model]]) tierById[model] = tier;
  };
  for (const provider of Object.values(PROVIDER_TIERS)) {
    for (const tier of TIER_ORDER) consider(provider.id, provider.models[tier], tier);
  }
  for (const [providerId, specialists] of Object.entries(PROVIDER_SPECIALISTS)) {
    for (const specialist of specialists) consider(providerId, specialist.model, specialist.tier);
  }
  // The lifecycle chooser needs to tell specialist rows from ladder rows, which KNOWN_MODELS merges.
  const specialistModels = Object.fromEntries(Object.entries(PROVIDER_SPECIALISTS).map(([providerId, specialists]) => {
    const ladder = new Set(Object.values(Object.values(PROVIDER_TIERS).find((provider) => provider.id === providerId)?.models ?? {}));
    return [providerId, specialists.map((specialist) => specialist.model).filter((model) => !ladder.has(model))];
  }));
  for (const [model, tiers] of Object.entries(ACCEPTED_MODELS)) {
    const highest = [...tiers].sort((a, b) => rank[a] - rank[b]).at(-1);
    consider('accepted', model, highest);
  }

  return `// OpenCode runtime adapters, generated from the canonical code-ops contracts.
//
// The plugin API exposes chat.params after the host resolves an agent and model but before
// the request reaches the provider. Throwing here blocks a known below-floor or unclassified
// binding. Unknown models fail closed: accepting them would turn a declared floor into prose.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = ${JSON.stringify(required, null, 2)};
const RANK = ${JSON.stringify(rank, null, 2)};
const KNOWN_MODELS = ${JSON.stringify(knownModels, null, 2)};
const TIER_BY_ID = ${JSON.stringify(tierById, null, 2)};
const SPECIALIST_MODELS = ${JSON.stringify(specialistModels, null, 2)};
// Read by the lifecycle chooser and the cost report, never by this gate.
const MODEL_PRICES = ${JSON.stringify(PROVIDER_PRICES, null, 2)};
const ROUTING_CARD = ${JSON.stringify(routingCard)};
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const SUITE_ROOT = join(PLUGIN_DIR, '..', 'code-ops', 'code-ops-suite');
const DIGEST_HOOK = join(SUITE_ROOT, 'hooks', 'digest-rewrite.mjs');
const QUERY = join(SUITE_ROOT, 'scripts', 'context-query.mjs');
const COMPACTION_CONTEXT = [
  'Compaction summary: the next context continues this work without redoing it or being told the constraints again. Preserve, in this order:',
  '(1) every problem met and how each was handled or resolved;',
  '(2) every option raised, tried, or set aside, and why;',
  '(3) everything asked for, decided, agreed, ruled out, or established as a preference, constraint, or boundary, in the words used;',
  '(4) exactly where things stand now: what is covered, settled, or complete;',
  '(5) everything still open, unresolved, promised, or expected next;',
  '(6) names, numbers, dates, paths, commit ids, register ids, links, and exact wording that would be hard to reconstruct.',
  "Keep what the developer said, asked for, or established close to their own words. Condense the assistant's own reasoning to its conclusions and outputs. Be complete on the six items even at the cost of length, and concise on everything else.",
  'Keep every <REDACTED:reason> marker as it stands and never restore a redacted value.',
  'Run artifacts on disk (registers, ledgers, receipts, HANDOFF.md) remain the authority; name their paths rather than restating their contents.',
].join('\\n');

export const CodeOpsModelFloors = async ({ directory = process.cwd() } = {}) => ({
  config: async (config) => {
    config.mcp ??= {};
    config.mcp['code-ops-docs'] ??= { type: 'local', command: ['node', join(SUITE_ROOT, 'scripts', 'lib-docs-mcp.mjs')], enabled: true };
    config.mcp['code-ops-query'] ??= { type: 'local', command: ['node', join(SUITE_ROOT, 'scripts', 'context-query-mcp.mjs')], enabled: true };
  },
  'chat.params': async (input) => {
    // A tier clone (\`<agent>-frontier\`, \`<agent>-lead\`) is held to its base agent's floor.
    const agent = String(input?.agent ?? '').replace(/-(light|mid|strong|frontier|lead)$/, '');
    const required = REQUIRED[input?.agent] ?? REQUIRED[agent];
    if (!required) return;
    const provider = input?.model?.providerID;
    const model = input?.model?.id;
    const actual = typeof provider === 'string' && typeof model === 'string'
      ? (KNOWN_MODELS[provider]?.[model] ?? TIER_BY_ID[model])
      : undefined;
    if (actual === undefined || RANK[actual] < RANK[required]) {
      const selected = typeof provider === 'string' && typeof model === 'string'
        ? \`${'${provider}'}/${'${model}'}\`
        : 'an unresolved model';
      throw new Error(
        \`Model-floor gate: agent "${'${input?.agent}'}" requires ${'${required}'}, but ${'${selected}'} is ${'${actual ?? "not in the verified tier table"}'}. Choose a listed ${'${required}'}-or-higher binding from MODEL_TIERS.md.\`,
      );
    }
  },
  'tool.execute.before': async (input, output) => {
    if (input?.tool !== 'bash') return;
    const run = spawnSync('node', [DIGEST_HOOK], {
      cwd: directory, encoding: 'utf8', timeout: 2000,
      input: JSON.stringify({ toolName: 'bash', input: output?.args, cwd: directory }),
    });
    if (run.status !== 0 || !run.stdout.trim()) return;
    try {
      const updated = JSON.parse(run.stdout).hookSpecificOutput?.updatedInput;
      if (updated && typeof updated === 'object') output.args = updated;
    } catch { /* canonical hook is fail-open */ }
  },
  event: async ({ event }) => {
    if (event?.type !== 'file.edited' || /^(off|0|false)$/i.test(process.env.CODE_OPS_INDEX ?? '')) return;
    const file = event.properties?.file;
    if (typeof file !== 'string' || !file) return;
    spawnSync('node', [QUERY, 'refresh', file], { cwd: directory, timeout: 5000, stdio: 'ignore' });
  },
  'experimental.chat.system.transform': async (_input, output) => {
    output.system.push(ROUTING_CARD);
  },
  'experimental.session.compacting': async (_input, output) => {
    output.context.push(COMPACTION_CONTEXT);
  },
});
`;
}

function modelTiersDoc(agents) {
  const providers = Object.values(PROVIDER_TIERS);
  const lines = [
    '# Model tiers',
    '',
    'Generated in the code-ops repository by `scripts/build-opencode-dist.mjs`. Do not edit.',
    '',
    'The suite routes operative work by capability tier, not by model name. The ladder is',
    'provider-agnostic — `frontier > strong > mid > light` — so any host can tell which of its',
    'models satisfies an agent’s floor. That is what makes the orchestration doctrine portable:',
    'the briefs, the fan-out rules, and the verification bar are identical everywhere, and only',
    'this table changes between providers.',
    '',
    `Model ids are pinned, verified against the models.dev registry on ${REGISTRY_VERIFIED_AT}, except a`,
    'provider marked as verified against its host CLI, whose ids come from `opencode models` on the date its',
    'entry records. Re-verify with `node scripts/check-model-registry.mjs --fetch` in the code-ops repository.',
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
    '## Premium specialists',
    '',
    'Specialists are explicit bounded alternatives. They never replace a ready-made config’s',
    'default lead or operative binding:',
    '',
    ...Object.entries(PROVIDER_SPECIALISTS).flatMap(([providerId, specialists]) => specialists.map((specialist) =>
      `- \`${providerId}/${specialist.model}\` — \`${specialist.tier}\` for ${specialist.uses.join(', ')}. ${specialist.notes}`)),
    '',
    '## Ready-made configs',
    '',
    'One config per provider ships under `configs/`, each binding every agent to its tier:',
    '',
    ...providers.map((p) => `- \`configs/opencode.${p.id}.json\``),
    ...Object.keys(PROVIDER_PRICES).map((id) => `- \`configs/model-profile.${id}.json\` — a starter chooser profile with prices and cost gates. Copy it to \`~/.claude/code-ops/opencode-model-profile.json\`.`),
    '',
    `\`opencode.json\` at the root is a copy of the \`${DEFAULT_PROVIDER}\` one, which costs nothing and leaves the lead`,
    'unset so it inherits the session model. Merge whichever you want into your own config rather',
    'than overwriting a config you already have, and keep your own copy out of a refresh.',
    '',
    ...runContractSection(),
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

// Run contracts take bare model ids and a version 4 contract needs a frontier lead, which the
// default ladder does not bind. Both facts are derived from the tier table, so the section
// cannot name a provider or model the validator would judge differently.
function runContractSection() {
  const fallback = PROVIDER_TIERS[DEFAULT_PROVIDER];
  const strong = fallback.models.strong;
  const collapsed = Object.values(PROVIDER_TIERS)
    .filter((p) => modelSupportsTier(p.models.strong, 'frontier'))
    .map((p) => p.label);
  return [
    '## Run contracts',
    '',
    '`run-contract.mjs` requires a `frontier` lead in every version 4 `RUN_CONTRACT.json`.',
    leadInherits(fallback)
      ? `The \`${DEFAULT_PROVIDER}\` ladder leaves the lead unset and binds no frontier model. Its contracts need a session model that another provider binds to \`frontier\`.`
      : `The \`${DEFAULT_PROVIDER}\` ladder binds \`${fallback.models.frontier}\` to \`frontier\`.`,
    '',
    'A `calibration` block is the only exception. It serves calibration arms (b) and (c) on the',
    `assess-only track, and it admits a \`strong\` lead such as \`${strong}\`. The validator rejects`,
    'the block when the lead model also serves the `frontier` rung, because that arm cannot',
    `measure a strong-versus-frontier gap. That rules out a strong lead from: ${collapsed.join(', ')}.`,
    '',
    `Contracts take bare model ids. Write \`${strong}\`, not \`${fallback.id}/${strong}\`. The`,
    'provider-prefixed form in the table above and in `opencode.json` fails the tier check.',
    '',
  ];
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

// A starter lifecycle profile for a token-priced provider, keyed the way readProfile() in
// opencode-lifecycle.js and opencode-cost-report.mjs read it. The budget and the cost gates
// describe a 15,000-credit month.
function starterProfile(providerId) {
  const prices = Object.fromEntries(Object.entries(PROVIDER_PRICES[providerId])
    .map(([model, { verifiedAt, source, ...rates }]) => [model, rates]));
  return {
    mode: 'lean',
    enabled: Object.keys(prices).map((model) => `${providerId}/${model}`),
    prices,
    credits_per_usd: 100,
    budget_credits: 15000,
    budget: '15,000 GitHub AI Credits ($150) per month',
    cost_gates: { max_projected_month_credits: 15000, max_context_peak: 200000, min_cache_hit_rate: 0.8 },
  };
}

function generatedReadme(skills, agents) {
  return [
    '# Generated opencode distribution',
    '',
    'This directory is generated in the code-ops repository (https://github.com/skylarsabo/code-ops)',
    'from the canonical packages under `../plugins/` by `node scripts/build-opencode-dist.mjs`.',
    'Do not edit files here directly; change the source package and rerun the renderer.',
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
    '- `code-ops/` — per-plugin `CONVENTIONS.md`, reference specs that skills cite, runtime',
    '  scripts, and non-discoverable tier-floor carriers for the vendored preflight scripts.',
    '- `plugins/` — the traceless-publishing gate, the model-floor gate, and the lifecycle',
    '  plugin. `code-ops/cost-report.mjs` reads the lifecycle cost ledger.',
    '- `opencode.json` — an example config binding every agent to its tier. Merge it into',
    '  your own config rather than overwriting one you already have.',
    '',
    '## Naming',
    '',
    "opencode's skill and agent namespaces are flat and its names cannot contain a colon, so",
    'every name is prefixed with its plugin: `/code-ops-suite:ship` becomes `/code-ops-suite-ship`.',
    'The prefix is load-bearing — `explorer` ships as an agent in two plugins.',
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
    'This opencode package is generated from the canonical Claude package in the code-ops repository.',
    'Rebuild it there with `node scripts/build-opencode-dist.mjs`; CI uses `--check` to prevent drift.',
    '',
    '## Deliberate host transforms',
    '',
    '- **Names are plugin-prefixed.** opencode discovers skills and agents into one flat',
    '  namespace and its name grammar (`^[a-z0-9]+(-[a-z0-9]+)*$`) has no colon, so',
    '  `code-ops-suite:ship` renders as `code-ops-suite-ship`. Without the prefix the two',
    '  `explorer` agents would collide on install.',
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
    '- **Agent `model:` becomes a portable capability-floor gate.** Each agent states its',
    '  required tier, every ready-made provider config binds it to that tier, and the',
    '  `chat.params` plugin hook blocks a known below-floor or unclassified binding before',
    '  the provider request. `MODEL_TIERS.md` is the verified allowlist for that check.',
    '- **The traceless hook is ported, not copied.** Claude’s `PreToolUse` hook is a',
    '  stdin/exit-code contract; the opencode plugin subscribes to `tool.execute.before` and',
    '  throws to block. Same policy, same fail-open-on-infrastructure-error stance.',
    '- **Digest rewrite and index refresh are ported.** OpenCode exposes mutable',
    '  `tool.execute.before` arguments and typed `file.edited` events. The adapters call the',
    '  canonical bundled digest and context-query scripts and preserve their off switches.',
    '- **Routing guidance and pre-compaction preservation are ported.** OpenCode exposes',
    '  `experimental.chat.system.transform` and',
    '  `experimental.session.compacting`, so the generated runtime plugin appends the',
    '  canonical preservation instruction to the compaction prompt.',
    '- **The typed subagent-start callback, transcript path, and pre-tool `agent_id` are',
    '  intentionally unavailable here.** `plugins/code-ops-lifecycle.js` covers those outcomes',
    '  on the events OpenCode does expose: a stable system prefix, the ladder on the implementer,',
    '  handoff and dispatch notes on the next tool result or user turn, a Task gate past the',
    '  context ceiling until the handoff assessment, a pending-handoff line on the first lead',
    '  system transform, and a cost ledger at session idle.',
    '- **The `code-ops-docs` and `code-ops-query` MCP servers are auto-configured.** The plugin',
    '  derives their absolute local commands from its own module URL and adds typed local MCP',
    '  entries without overwriting operator-defined entries.',
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
        const alias = fieldValue(header, 'model', file);
        const tier = CLAUDE_ALIAS_TIER[alias];
        agents.push({ name, tier, plugin: pluginName, sourceName: fieldValue(header, 'name', file), alias });
        add(`agents/${name}.md`, transformAgent(pluginName, contents, file));
        add(`code-ops/${pluginName}/agents/${file.split(sep).at(-1)}`, floorCarrierAgent(contents, file));
      }
      const roles = agents.filter((agent) => agent.plugin === pluginName).map((agent) => ({ name: agent.sourceName, sourceModel: agent.alias, minimumTier: agent.tier }));
      add(`code-ops/${pluginName}/agents/model-floors.json`, `${JSON.stringify({ version: 1, roles }, null, 2)}\n`);
    }

    add(`code-ops/${pluginName}/CONVENTIONS.md`, transformConventions(readText(sourcePath(pluginName, 'CONVENTIONS.md'))));
    // Skills cite vendored execution specs under reference/. They take the skill-text transform,
    // not transformConventions, which rewrites paragraphs that exist only in CONVENTIONS.md.
    for (const file of walkFiles(sourcePath(pluginName, 'reference'))) {
      add(`code-ops/${pluginName}/reference/${toPosix(relative(sourcePath(pluginName, 'reference'), file))}`, portableText(readText(file)));
    }
    for (const file of walkFiles(sourcePath(pluginName, 'scripts'))) {
      add(`code-ops/${pluginName}/scripts/${toPosix(relative(sourcePath(pluginName, 'scripts'), file))}`, readText(file));
    }
    if (pluginName === 'code-ops-suite') add('code-ops/code-ops-suite/hooks/digest-rewrite.mjs', readText(sourcePath(pluginName, 'hooks', 'digest-rewrite.mjs')));
  }

  add('plugins/code-ops-traceless.js', tracelessPlugin());
  add('plugins/code-ops-model-floors.js', modelFloorPlugin(agents, routingCardText()));
  add('plugins/code-ops-lifecycle.js', readText(resolve(ROOT, 'scripts', 'opencode-lifecycle.js')));
  add('code-ops/cost-report.mjs', readText(resolve(ROOT, 'scripts', 'opencode-cost-report.mjs')));
  add('MODEL_TIERS.md', modelTiersDoc(agents));
  add('PLATFORM_COMPATIBILITY.md', compatibilityNotes());
  add('README.md', generatedReadme(skills, agents));
  // One config per provider: the whole point of the tier ladder is that moving the suite to
  // another provider is a config swap, not a rewrite. The root file copies the default one.
  for (const providerId of Object.keys(PROVIDER_TIERS)) {
    add(`configs/opencode.${providerId}.json`, JSON.stringify(exampleConfig(agents, providerId), null, 2) + '\n');
  }
  add('opencode.json', JSON.stringify(exampleConfig(agents, DEFAULT_PROVIDER), null, 2) + '\n');
  for (const providerId of Object.keys(PROVIDER_PRICES)) {
    add(`configs/model-profile.${providerId}.json`, JSON.stringify(starterProfile(providerId), null, 2) + '\n');
  }
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
    expect(!RESIDUAL_SKILL_REF.test(contents), `${path} retains an uncallable bare Claude skill reference`);
    expect(contents.includes('**OpenCode runtime note:**'), `${path} does not classify unsupported canonical hooks`);
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
    const carrier = `code-ops/${agent.plugin}/agents/${agent.sourceName}.md`;
    const carrierText = files.get(carrier);
    expect(carrierText !== undefined, `${carrier} is missing for the vendored preflight`);
    expect(carrierText?.includes(`name: ${agent.sourceName}`), `${carrier} does not carry the source agent name`);
    expect(carrierText?.includes(`model: ${agent.alias}`), `${carrier} does not carry the source model floor`);
  }

  for (const pluginName of PLUGIN_NAMES) {
    for (const file of walkFiles(sourcePath(pluginName, 'reference'))) {
      const path = `code-ops/${pluginName}/reference/${toPosix(relative(sourcePath(pluginName, 'reference'), file))}`;
      const contents = files.get(path);
      expect(contents !== undefined, `${path} is missing`);
      expect(!contents?.includes(ROOT_TOKEN), `${path} retains the Claude plugin-root token`);
      expect(!RESIDUAL_SKILL_REF.test(contents ?? ''), `${path} retains an uncallable bare Claude skill reference`);
    }
  }

  const plugin = files.get('plugins/code-ops-traceless.js');
  expect(plugin.includes("'tool.execute.before'"), 'the traceless plugin does not subscribe to tool.execute.before');
  expect(plugin.includes("input?.tool !== 'bash'"), 'the traceless plugin does not gate the bash tool');
  expect(plugin.includes('throw new Error('), 'the traceless plugin cannot block a call');
  expect(files.has('code-ops/code-ops-suite/scripts/scan-ai-tells.mjs'), 'the traceless plugin has no scanner to resolve');

  const floors = files.get('plugins/code-ops-model-floors.js');
  expect(floors?.includes("'chat.params'"), 'the model-floor plugin does not subscribe to chat.params');
  expect(floors?.includes('TIER_BY_ID'), 'the model-floor plugin does not resolve a reseller model by bare id');
  expect(floors?.includes("'experimental.session.compacting'"), 'the model-floor plugin does not port compaction preservation');
  const lifecycle = files.get('plugins/code-ops-lifecycle.js');
  expect(lifecycle?.includes('export const CodeOpsLifecycle'), 'the lifecycle plugin does not export its factory');
  expect(lifecycle?.includes('CODE_OPS_COST_LEDGER'), 'the lifecycle plugin does not write the cost ledger');
  expect(files.has('code-ops/cost-report.mjs'), 'the cost report was not rendered');
  for (const agent of agents) {
    expect(floors?.includes(JSON.stringify(agent.name)), `the model-floor plugin does not know ${agent.name}`);
  }

  const conventions = files.get('code-ops/code-ops-suite/CONVENTIONS.md');
  expect(conventions?.includes('**OpenCode runtime limits.**'), 'OpenCode conventions do not classify unavailable hook mechanics');
  expect(!conventions?.includes('Four mechanisms ship with this plugin and are on by default'), 'OpenCode conventions still claim unavailable hooks run by default');
  expect(conventions?.includes('`CODE_OPS_COST_LEDGER` are process-environment switches'), 'OpenCode conventions omit the runtime switch location');
  for (const pluginName of ['privacy-opsec-suite', 'researcher', 'rigor']) {
    const sibling = files.get(`code-ops/${pluginName}/CONVENTIONS.md`);
    expect(sibling?.includes('**OpenCode sibling runtime.**'), `${pluginName} conventions retain the Claude sibling-runtime claim`);
    expect(sibling?.includes('routing and compaction have no off switch'), `${pluginName} conventions overstate OpenCode runtime switches`);
    expect(!sibling?.includes('.claude/settings.json'), `${pluginName} conventions retain the Claude settings location`);
  }
  const conform = files.get('skills/code-ops-suite-conform/SKILL.md');
  expect(conform?.includes('`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and `~/.codex/AGENTS.md`'), 'OpenCode global-standards render collapsed host-specific contract paths');
  expect(conform?.includes('`CLAUDE.md` and `AGENTS.md`'), 'OpenCode repo-standards render collapsed the accepted parity modes');

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
