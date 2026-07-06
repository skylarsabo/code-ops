#!/usr/bin/env node
// Structural linter for the code-ops plugin marketplace.
//
// Zero-dependency. Run from anywhere: `node scripts/lint-plugins.mjs`.
// Exits non-zero on any structural problem (CI gate). It deliberately checks
// only mechanical invariants that humans get wrong — the kind of drift the
// suite's own `doc-alignment` / `rigor` skills preach catching but that the
// marketplace had no automated backstop for:
//
//   1. Manifests parse + carry name/version/description; marketplace <-> plugin.json
//      agree; sources resolve; no duplicate entries; no unregistered plugin dir.
//   2. Every README "(N skills)" count matches the real skills/ dir count, and
//      every skill slug is mentioned (word-boundary) in its plugin README.
//   3. Every SKILL.md has a frontmatter `description:`, a `## Done when` heading,
//      and references CONVENTIONS.md (the suite's completion + backbone contract).
//   4. Each plugin has the CONVENTIONS.md its skills reference.
//   5. Orchestrator skills only reference skills that actually exist — intra-plugin
//      orchestrators against their OWN plugin, `everything` across all — and every
//      qualified `<plugin>:<skill>` reference (in any skill) resolves.
//   6. Every ${CLAUDE_PLUGIN_ROOT}/scripts/X a skill references is bundled in that
//      plugin and byte-identical to the canonical scripts/X.
//   7. No skill copy-pastes a 40+ word passage verbatim out of its CONVENTIONS.md.
//   8. (when docs/handbook/commands/ exists) every skill has an entry heading
//      `### `/<plugin>:<skill>`` in docs/handbook/commands/<plugin>.md AND a qualified
//      reference in the README router table; every such heading names a real skill.
//   9. Every `§<id>` cited in a SKILL.md or agents/*.md resolves to a real `## <id> ·`
//      section of the owning plugin's CONVENTIONS.md — or of a plugin named earlier on
//      the same line ("rigor §H"); subsection forms (§11.9) resolve on the base id.
//  10. "the <name> subagent" prose in a SKILL.md or agents/*.md names an agent actually
//      bundled in that plugin (agents/*.md frontmatter `name:`), modulo a small
//      generic-word allowlist (mirrors ORCH_TOKEN_ALLOWLIST).
//  11. No `<` / `>` in a SKILL.md frontmatter value — frontmatter is injected verbatim
//      into the system prompt at discovery (before the body is read), so angle-bracketed
//      markup there is a prompt-injection surface no body-level guard sees.
//
// It does NOT judge prose quality — that's the human's job.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const rel = (p) => p.slice(ROOT.length + 1).replaceAll('\\', '/');
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, ''); // tolerate a UTF-8 BOM when parsing
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `everything` is the cross-plugin orchestrator (references skills across all plugins);
// full-sweep / rigor-sweep are intra-plugin (must reference only their OWN plugin's skills).
const CROSS_PLUGIN_ORCH = new Set(['everything']);
const INTRA_PLUGIN_ORCH = new Set(['full-sweep', 'rigor-sweep', 'research-sweep']);
// Lowercase slug-shaped tokens that legitimately appear emphasized in an orchestrator but
// are NOT skills (track names, automation levels, plugin names, opsec terms, phase words).
const ORCH_TOKEN_ALLOWLIST = new Set([
  'assess-only', 'audit-only', 'auto-all', 'auto-safe', 'auto-fix', 'fail-closed', 'gated',
  'code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher',
  'full', 'track', // emphasized prose words in the sweeps ("the full pass", "per track"), not skills
  'deep-research', 'lib-docs', 'code-ops-docs', // external skill / bundled script / MCP server the researcher composes, not researcher skills
]);
const SLUGISH = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // single-word OR hyphenated lowercase token

function readJSON(path) {
  try {
    return JSON.parse(readText(path));
  } catch (e) {
    fail(`invalid JSON: ${rel(path)} — ${e.message}`);
    return null;
  }
}
function listDirs(path) {
  return existsSync(path)
    ? readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
}
// Skill dirs only: ignore `_`/`.`-prefixed helper/asset directories (LINT-013).
const listSkillDirs = (path) => listDirs(path).filter((d) => !d.startsWith('_') && !d.startsWith('.'));
function emphasizedSlugTokens(body) {
  const toks = new Set();
  for (const m of body.matchAll(/\*\*([a-z0-9][a-z0-9-]*)\*\*/g)) if (SLUGISH.test(m[1])) toks.add(m[1]);
  for (const m of body.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)) if (SLUGISH.test(m[1])) toks.add(m[1]);
  return toks;
}
function mentions(text, slug) {
  return new RegExp('(^|[^a-z0-9-])' + escapeRe(slug) + '([^a-z0-9-]|$)').test(text);
}

// ---- 1. marketplace + manifests --------------------------------------------
const mpPath = join(ROOT, '.claude-plugin', 'marketplace.json');
if (!existsSync(mpPath)) fail('missing .claude-plugin/marketplace.json');
const mp = existsSync(mpPath) ? readJSON(mpPath) : null;

const plugins = []; // { name, dir, manifest, skills, readme }
const seenNames = new Set();
const seenSources = new Set();
const registeredSources = new Set();
if (mp && Array.isArray(mp.plugins)) {
  for (const entry of mp.plugins) {
    if (seenNames.has(entry.name)) fail(`duplicate marketplace entry name "${entry.name}"`);
    seenNames.add(entry.name);
    if (typeof entry.source !== 'string') {
      warn(`marketplace entry "${entry.name}": non-local source, skipping path checks`);
      continue;
    }
    if (seenSources.has(entry.source)) fail(`duplicate marketplace source "${entry.source}"`);
    seenSources.add(entry.source);
    const dir = resolve(ROOT, entry.source);
    registeredSources.add(dir);
    if (!existsSync(dir)) {
      fail(`marketplace entry "${entry.name}": source dir missing (${entry.source})`);
      continue;
    }
    const manPath = join(dir, '.claude-plugin', 'plugin.json');
    const manifest = existsSync(manPath) ? readJSON(manPath) : null;
    if (!manifest) {
      fail(`"${entry.name}": missing .claude-plugin/plugin.json`);
    } else {
      for (const f of ['name', 'version', 'description']) {
        if (typeof manifest[f] !== 'string' || !manifest[f].trim()) fail(`"${entry.name}": plugin.json missing non-empty ${f}`);
      }
      if (manifest.name !== entry.name)
        fail(`name mismatch: marketplace "${entry.name}" vs plugin.json "${manifest.name}"`);
      if (entry.version !== manifest.version)
        fail(`version mismatch for "${entry.name}": marketplace ${entry.version} vs plugin.json ${manifest.version}`);
    }
    if (!existsSync(join(dir, 'CONVENTIONS.md')))
      fail(`"${entry.name}": missing CONVENTIONS.md (every skill references it)`);
    const readmePath = join(dir, 'README.md');
    if (!existsSync(readmePath)) warn(`"${entry.name}": no README.md`);
    plugins.push({
      name: entry.name,
      dir,
      manifest,
      skills: listSkillDirs(join(dir, 'skills')),
      readme: existsSync(readmePath) ? readText(readmePath) : '',
    });
  }
} else if (mp) {
  fail('marketplace.json has no "plugins" array');
}

// Any on-disk plugin dir not registered in the marketplace is invisible to every check above.
for (const d of listDirs(join(ROOT, 'plugins'))) {
  if (!registeredSources.has(resolve(ROOT, 'plugins', d))) fail(`plugins/${d} is not registered in marketplace.json`);
}

const allSlugs = new Set(plugins.flatMap((p) => p.skills));
const pluginByName = new Map(plugins.map((p) => [p.name, p]));
const QUALIFIED_RE = plugins.length
  ? new RegExp(`\\b(${plugins.map((p) => escapeRe(p.name)).join('|')}):([a-z0-9-]+)`, 'g')
  : null;

// ---- 2/3/5. per-plugin: README mentions, SKILL.md structure, orchestrator refs
for (const p of plugins) {
  for (const slug of p.skills) {
    if (p.readme && !mentions(p.readme, slug))
      fail(`${p.name}/README.md does not mention skill "${slug}"`);
  }
  for (const slug of p.skills) {
    const skPath = join(p.dir, 'skills', slug, 'SKILL.md');
    if (!existsSync(skPath)) {
      fail(`${p.name}/${slug}: missing SKILL.md`);
      continue;
    }
    const body = readText(skPath);
    const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) fail(`${p.name}/${slug}: missing YAML frontmatter`);
    else if (!/^description:[ \t]*\S/m.test(fm[1])) fail(`${p.name}/${slug}: frontmatter missing non-empty description`); // [ \t] not \s: \s spans the newline and matches the next key
    if (fm) {
      // An unquoted scalar containing ": " (colon-space) or a trailing colon breaks
      // the YAML parser, so the frontmatter silently loads as EMPTY metadata at runtime.
      for (const raw of fm[1].split('\n')) {
        const line = raw.replace(/\r$/, '');
        const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]+(.+?)[ \t]*$/);
        if (!kv) continue;
        const val = kv[2];
        if (!/^["'[{|>&*]/.test(val)) { // quoted / block / flow scalars are exempt from the colon check only
          if (val.includes(': ') || /:$/.test(val))
            fail(`${p.name}/${slug}: frontmatter "${kv[1]}" has an unquoted colon — wrap the value in double quotes (breaks YAML; metadata silently dropped at runtime)`);
        }
        // Frontmatter values are injected verbatim into the system prompt at discovery
        // time (before the body is ever read), so angle-bracketed markup in one is a
        // prompt-injection surface no body-level guard ever sees. Quoting does not help.
        if (/[<>]/.test(val) && !/^[|>]/.test(val))
          fail(`${p.name}/${slug}: frontmatter "${kv[1]}" contains "<" or ">" — angle brackets inject into the system prompt at discovery; rephrase without them`);
      }
    }
    if (!/^##\s+Done when/im.test(body)) fail(`${p.name}/${slug}: missing "## Done when" section`);
    if (!body.includes('CONVENTIONS.md')) fail(`${p.name}/${slug}: does not reference CONVENTIONS.md`);

    // Qualified <plugin>:<skill> references must resolve (checked in every skill, not just orchestrators).
    if (QUALIFIED_RE) {
      for (const m of body.matchAll(QUALIFIED_RE)) {
        const target = pluginByName.get(m[1]);
        if (target && !target.skills.includes(m[2]))
          fail(`${p.name}/${slug}: references ${m[1]}:${m[2]} but "${m[2]}" is not a skill in ${m[1]}`);
      }
    }

    // Bare emphasized skill tokens in an orchestrator must be in scope.
    const validSet = CROSS_PLUGIN_ORCH.has(slug) ? allSlugs : (INTRA_PLUGIN_ORCH.has(slug) ? new Set(p.skills) : null);
    if (validSet) {
      for (const tok of emphasizedSlugTokens(body)) {
        if (!validSet.has(tok) && !ORCH_TOKEN_ALLOWLIST.has(tok))
          fail(`${p.name}/${slug}: references unknown skill-like token "${tok}" — not a skill in scope (rename it, or add to ORCH_TOKEN_ALLOWLIST if intentional)`);
      }
    }
  }
}

// ---- 4. root README skill-count parity (scoped to the plugin's own bullet line) ----
const rootReadmePath = join(ROOT, 'README.md');
if (existsSync(rootReadmePath)) {
  const rr = readText(rootReadmePath);
  for (const p of plugins) {
    let count = null;
    for (const line of rr.split('\n')) {
      if (line.includes('`' + p.name + '`')) { const m = line.match(/\((\d+)\s+skills\)/); if (m) { count = Number(m[1]); break; } }
    }
    if (count === null) { warn(`root README: no "(N skills)" count found on the \`${p.name}\` line`); continue; }
    if (count !== p.skills.length) fail(`root README count for ${p.name}: says ${count}, actual ${p.skills.length}`);
  }
} else {
  warn('no root README.md');
}

// ---- 6. bundled runtime scripts must match the canonical (copy-on-build) ----
// Skills invoke these via ${CLAUDE_PLUGIN_ROOT}/scripts/, so each must ship inside
// every plugin that references it and stay byte-identical to the repo-root source.
const RUNTIME_SCRIPTS = [
  { name: 'revalidate-register.mjs', plugins: ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'] },
  { name: 'scan-ai-tells.mjs', plugins: ['privacy-opsec-suite', 'code-ops-suite'] },
  { name: 'lib-docs.mjs', plugins: ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'] },
  { name: 'lib-docs-mcp.mjs', plugins: ['code-ops-suite'] },
  { name: 'research-manifest.mjs', plugins: ['researcher'] },
];
// RUNTIME_SCRIPTS plugin names must be real (a typo silently disables the missing-script check).
for (const rs of RUNTIME_SCRIPTS) for (const pn of rs.plugins) if (!pluginByName.has(pn)) fail(`RUNTIME_SCRIPTS lists unknown plugin "${pn}" for ${rs.name}`);
for (const rs of RUNTIME_SCRIPTS) {
  const canonical = join(ROOT, 'scripts', rs.name);
  if (!existsSync(canonical)) { fail(`missing canonical scripts/${rs.name}`); continue; }
  const canon = readFileSync(canonical, 'utf8');
  for (const p of plugins) {
    const copy = join(p.dir, 'scripts', rs.name);
    const mustHave = rs.plugins.includes(p.name);
    if (mustHave && !existsSync(copy)) fail(`${p.name}: missing bundled scripts/${rs.name} (a skill references it)`);
    else if (existsSync(copy) && readFileSync(copy, 'utf8') !== canon) fail(`${p.name}: scripts/${rs.name} has drifted from the canonical scripts/${rs.name} — re-copy it`);
  }
}
// Derived check: every ${CLAUDE_PLUGIN_ROOT}/scripts/X referenced by a skill/CONVENTIONS must be bundled+identical.
const SCRIPT_REF_RE = /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([\w.-]+\.mjs)/g;
for (const p of plugins) {
  const refd = new Set();
  const bodies = [...p.skills.map((s) => join(p.dir, 'skills', s, 'SKILL.md')), join(p.dir, 'CONVENTIONS.md')];
  for (const f of bodies) if (existsSync(f)) for (const m of readText(f).matchAll(SCRIPT_REF_RE)) refd.add(m[1]);
  for (const name of refd) {
    const copy = join(p.dir, 'scripts', name);
    const canonical = join(ROOT, 'scripts', name);
    if (!existsSync(copy)) fail(`${p.name}: a skill references \${CLAUDE_PLUGIN_ROOT}/scripts/${name} but it is not bundled in this plugin`);
    else if (!existsSync(canonical)) fail(`${p.name}: bundled scripts/${name} has no canonical scripts/${name} at the repo root — cannot verify it against a source of truth`);
    else if (readFileSync(copy, 'utf8') !== readFileSync(canonical, 'utf8')) fail(`${p.name}: scripts/${name} drifted from the canonical scripts/${name} — re-copy it`);
  }
}

// ---- 7. no skill copy-pastes a long passage of its CONVENTIONS (drift guard) ----
// A skill restating a whole CONVENTIONS section drifts when that section is edited.
// Flag any 40+ contiguous-word run a skill shares verbatim with its CONVENTIONS;
// reference the section by number instead.
const DUP_NGRAM = 40;
const normWords = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
for (const p of plugins) {
  const convPath = join(p.dir, 'CONVENTIONS.md');
  if (!existsSync(convPath)) continue;
  const conv = normWords(readText(convPath));
  if (conv.length < DUP_NGRAM) continue;
  const grams = new Set();
  for (let i = 0; i + DUP_NGRAM <= conv.length; i++) grams.add(conv.slice(i, i + DUP_NGRAM).join(' '));
  for (const slug of p.skills) {
    const skPath = join(p.dir, 'skills', slug, 'SKILL.md');
    if (!existsSync(skPath)) continue;
    const w = normWords(readText(skPath));
    for (let i = 0; i + DUP_NGRAM <= w.length; i++) {
      if (grams.has(w.slice(i, i + DUP_NGRAM).join(' '))) {
        fail(`${p.name}/${slug}: copies a ${DUP_NGRAM}+ word passage verbatim from CONVENTIONS ('${w.slice(i, i + 8).join(' ')}...') — reference the section instead`);
        break;
      }
    }
  }
}

// ---- 8. handbook command reference parity (per-plugin page + router table) ----
// The handbook is the human-facing front door; it drifts the moment a skill is added or
// renamed without touching docs. For every skill we require BOTH:
//   a) an entry heading of the exact form `### ` + "`/<plugin>:<skill>`" in
//      docs/handbook/commands/<plugin>.md, and
//   b) a qualified `/<plugin>:<skill>` reference in the README router table.
// The reverse also has to hold: every `### `/<plugin>:<skill>`` heading must name a real skill.
const handbookDir = join(ROOT, 'docs', 'handbook', 'commands');
if (existsSync(handbookDir)) {
  // Router table: the `## The task → command router` section of the index, sliced off at the
  // next `##` heading so the per-plugin reference list below it does not count as "in the router".
  const routerReadmePath = join(handbookDir, 'README.md');
  let routerText = null;
  if (!existsSync(routerReadmePath)) {
    fail(`handbook: missing ${rel(routerReadmePath)} (the command router index)`);
  } else {
    const rr = readText(routerReadmePath);
    const start = rr.search(/^##\s+The task .* command router\s*$/m);
    if (start === -1) {
      fail(`handbook: ${rel(routerReadmePath)} has no "## The task → command router" section`);
    } else {
      const rest = rr.slice(start + 1);
      const next = rest.search(/^##\s+/m);
      routerText = next === -1 ? rr.slice(start) : rr.slice(start, start + 1 + next);
    }
  }

  for (const p of plugins) {
    const pagePath = join(handbookDir, `${p.name}.md`);
    if (!existsSync(pagePath)) {
      fail(`handbook: missing ${rel(pagePath)} (referenced for every ${p.name} skill)`);
    } else {
      const page = readText(pagePath);
      // Collect every `### `/<plugin>:<skill>`` heading on this page (exact form), then diff
      // against the real skill set in both directions.
      const headingRe = new RegExp(`^###\\s+\`/${escapeRe(p.name)}:([a-z0-9-]+)\`\\s*$`, 'gm');
      const headedSkills = new Set();
      for (const m of page.matchAll(headingRe)) headedSkills.add(m[1]);
      for (const slug of p.skills) {
        if (!headedSkills.has(slug))
          fail(`handbook: ${rel(pagePath)} has no entry heading "### \`/${p.name}:${slug}\`" for skill "${slug}"`);
      }
      for (const slug of headedSkills) {
        if (!p.skills.includes(slug))
          fail(`handbook: ${rel(pagePath)} has entry heading "### \`/${p.name}:${slug}\`" but "${slug}" is not a skill in ${p.name}`);
      }
    }
    // Router-table membership: a qualified `/<plugin>:<skill>` reference inside the router slice.
    if (routerText !== null) {
      for (const slug of p.skills) {
        if (!mentions(routerText, `/${p.name}:${slug}`))
          fail(`handbook: README router table does not reference "/${p.name}:${slug}"`);
      }
    }
  }
}

// ---- 9/10. section-reference + agent-name integrity (SKILL.md + agents/*.md) ----
// Skills and agents cite CONVENTIONS sections (`§9`, `CONVENTIONS §A`, `rigor §H`) and
// bundled subagents ("fan out to the privacy-reviewer subagent") by name. A renumbered
// section or a renamed/unbundled agent silently orphans every such reference — the
// pointer reads fine and resolves to nothing at runtime.
const docFiles = (p) => [
  ...p.skills.map((s) => join(p.dir, 'skills', s, 'SKILL.md')),
  ...(existsSync(join(p.dir, 'agents'))
    ? readdirSync(join(p.dir, 'agents')).filter((f) => f.endsWith('.md')).map((f) => join(p.dir, 'agents', f))
    : []),
].filter(existsSync);

// 9. §<id> tokens resolve against the owning plugin's CONVENTIONS section ids, or —
// for cross-plugin prose like "rigor §4" — against a plugin named earlier on the same
// line. A subsection form (§11.9) resolves on the part before the dot.
const sectionIds = new Map(); // plugin name -> Set of `## <id> ·` heading ids
for (const p of plugins) {
  const ids = new Set();
  const convPath = join(p.dir, 'CONVENTIONS.md');
  if (existsSync(convPath)) for (const m of readText(convPath).matchAll(/^##\s+(\S+)\s*·/gm)) ids.add(m[1]);
  sectionIds.set(p.name, ids);
}
const SECTION_TOKEN_RE = /§([A-Za-z0-9]+(?:\.[0-9]+)?)/g;
for (const p of plugins) {
  const own = sectionIds.get(p.name);
  for (const f of docFiles(p)) {
    const lines = readText(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(SECTION_TOKEN_RE)) {
        const base = m[1].split('.')[0];
        if (own.has(base)) continue;
        const before = lines[i].slice(0, m.index);
        if (plugins.some((q) => sectionIds.get(q.name).has(base) && mentions(before, q.name))) continue;
        fail(`${rel(f)}:${i + 1}: references §${m[1]} but no "## ${base} ·" section exists in ${p.name}/CONVENTIONS.md (or in a plugin named earlier on the line)`);
      }
    }
  }
}

// 10. "the <name> subagent" prose must name an agent bundled in the plugin (built from
// agents/*.md frontmatter `name:`). Handles slash-joined lists ("the tracer/verifier
// subagents") and backticked names; generic determiner-phrases ("a fresh sub-agent")
// pass via the allowlist. Non-determiner prose ("each sub-agent") is not matched.
const AGENT_PROSE_ALLOWLIST = new Set(['fresh', 'parallel']);
const AGENT_REF_RE = /\b(?:the|a|an)\s+([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*)\s+sub-?agents?\b/gi;
for (const p of plugins) {
  const agentNames = new Set();
  const agentsDir = join(p.dir, 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (!f.endsWith('.md')) continue;
      const fm = readText(join(agentsDir, f)).match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const nm = fm && fm[1].match(/^name:[ \t]*(\S+)/m);
      agentNames.add(nm ? nm[1] : f.slice(0, -3));
    }
  }
  for (const f of docFiles(p)) {
    const lines = readText(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].replaceAll('`', '').matchAll(AGENT_REF_RE)) {
        for (const name of m[1].toLowerCase().split('/')) {
          if (!agentNames.has(name) && !AGENT_PROSE_ALLOWLIST.has(name))
            fail(`${rel(f)}:${i + 1}: prose names "the ${name} subagent" but ${p.name} bundles ${agentNames.size ? [...agentNames].join(', ') : 'no agents'} — rename it, or add to AGENT_PROSE_ALLOWLIST if it's a generic word`);
        }
      }
    }
  }
}

// ---- report ----------------------------------------------------------------
for (const w of warnings) console.log(`  warning: ${w}`);
if (errors.length) {
  console.error(`\nFAIL — ${errors.length} structural problem(s):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}
const totalCommands = plugins.reduce((n, p) => n + p.skills.length, 0);
console.log(`OK — ${plugins.length} plugins, ${totalCommands} commands (${allSlugs.size} unique skills), no structural problems.`);
