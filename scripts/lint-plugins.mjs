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
//   8. (when code-ops-docs/40 Engineering/Handbook/commands/ exists) every skill has an entry heading
//      `### `/<plugin>:<skill>`` in code-ops-docs/40 Engineering/Handbook/commands/<plugin>.md AND a qualified
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
//  12. Every bundled agent declares a frontmatter `model:` tier at or above its floor in
//      AGENT_MODEL_FLOORS (haiku < sonnet < opus) — downgrading the verification core is
//      a visible diff, never a silent frontmatter tweak; the handbook's "(model: `X`)"
//      annotations must match the frontmatter.
//  13. The register-producing skills' Done-when keeps running revalidate-register.mjs
//      (the producer-side anchor gate cannot silently regress out of the wiring).
//  14. SHARED_PASSAGES: the deliberately-duplicated doctrine cores are pinned byte-identically
//      across every file that carries them — a partial doctrine rollout fails CI.
//  15. Each code-ops-docs/40 Engineering/Handbook/commands/README.md "Per-plugin command references" bullet's bolded
//      "**N commands**" count matches the plugin's actual skill count.
//  16. ADVISORY ONLY (never gates): every root scripts/*.mjs with no reference anywhere under
//      evals/ is flagged as a candidate for a regression eval.
//  17. Every "From skill" / "Invokes" edge in code-ops-docs/40 Engineering/Techniques/skill-composition.md's table
//      resolves to a real plugins/<plugin>/skills/<skill>/ directory — a renamed or removed
//      skill silently orphans the composition map otherwise.
//  18. Every evals/<name>/ directory that contains a run.mjs is invoked as the literal string
//      `node evals/<name>/run.mjs` somewhere in .github/workflows/validate.yml — an eval nobody
//      wired into CI provides no real backstop against the regression it guards.
//  19. No executable/config surface (plugins/**/*.mjs, scripts/*.mjs, .github/workflows/*.yml,
//      plugins/**/hooks/*.json) wires PR auto-merge: the gh CLI merge subcommand combined with
//      its auto flag on the same line, an auto-merge config key set true-ish, or the GitHub
//      GraphQL auto-merge-enabling mutation by name. .md doctrine prose is deliberately
//      excluded — it legitimately talks ABOUT never auto-merging. (This item's own prose
//      avoids spelling out the literal tokens so it doesn't trip check 19 on itself; see the
//      check's own comment block for the exact denylist.)
//  20. CLAUDE.md and AGENTS.md are byte-identical: they are one standards contract under the
//      two names different hosts read, and a divergence is invisible to whichever host reads
//      the other copy.
//  21. (when code-ops-docs/40 Engineering/Handbook/README.md and code-ops-docs/40 Engineering/Techniques/ both exist) every technique page has
//      a link entry in the handbook README's techniques list, every listed entry resolves to a
//      real page, and the written-out "N techniques" count matches the page count.
//  22. (when code-ops-docs/40 Engineering/Techniques/skill-composition.md exists) the composition map matches the skill
//      tree in both directions: every qualified `<plugin>:<skill>` reference in a SKILL.md body
//      (the skill's own name excluded) has an edge row under the page's "## The edges" heading,
//      and every such row has a reference. Check 17 only proves the named edges resolve, so the
//      map could drift from the tree without either side failing.
//  23. This marketplace keeps its Node SSOT, action lock, update-bot config, checker, and both
//      platform invocations present. Removing the policy and its call sites cannot disable the
//      supply-chain gate silently.
//
// It does NOT judge prose quality — that's the human's job.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_SCRIPTS } from './vendored-manifest.mjs';
import { CLAUDE_ALIAS_TIER, TIER_RANK } from './model-tiers.mjs';

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
const CROSS_PLUGIN_ORCH = new Set(['everything', 'local-review-gate']);
const INTRA_PLUGIN_ORCH = new Set(['full-sweep', 'rigor-sweep', 'research-sweep', 'conform']);
// Lowercase slug-shaped tokens that legitimately appear emphasized in an orchestrator but
// are NOT skills (track names, automation levels, plugin names, opsec terms, phase words).
const ORCH_TOKEN_ALLOWLIST = new Set([
  'assess-only', 'audit-only', 'auto-all', 'auto-safe', 'auto-fix', 'fail-closed', 'gated',
  'code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher',
  'full', 'track', // emphasized prose words in the sweeps ("the full pass", "per track"), not skills
  'deep-research', 'lib-docs', 'code-ops-docs', // external skill / bundled script / MCP server the researcher composes, not researcher skills
  'local-deep-review', 'local-opsec-gate', // GitHub commit-status contexts, not skills
  'available', 'unavailable', // judgment execution-policy values, not skills
  'assume-unchanged', 'skip-worktree', // Git index flags, not skills
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
// RUNTIME_SCRIPTS itself lives in ./vendored-manifest.mjs (imported above) — the same
// table scripts/sync-vendored.mjs uses to actually copy the files.
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
// Reverse check: every bundled runtime script must be declared for that plugin. Without this,
// an extra stale copy can survive forever because the forward manifest walk never sees it.
for (const p of plugins) {
  const scriptsDir = join(p.dir, 'scripts');
  if (!existsSync(scriptsDir)) continue;
  for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
    const declared = RUNTIME_SCRIPTS.some((runtime) => runtime.name === entry.name && runtime.plugins.includes(p.name));
    if (!declared) fail(`${p.name}: bundled scripts/${entry.name} is not declared for this plugin in RUNTIME_SCRIPTS`);
  }
}
// Derived check: every ${CLAUDE_PLUGIN_ROOT}/scripts/X referenced by a plugin-owned prompt,
// agent, README, or manifest surface must be bundled and byte-identical.
const SCRIPT_REF_RE = /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([\w.-]+\.mjs)/g;
for (const p of plugins) {
  const refd = new Map();
  const bodies = [
    ...p.skills.map((s) => join(p.dir, 'skills', s, 'SKILL.md')),
    join(p.dir, 'CONVENTIONS.md'),
    join(p.dir, 'README.md'),
    join(p.dir, '.claude-plugin', 'plugin.json'),
    ...walkFiles(join(p.dir, 'agents')),
    ...p.skills.flatMap((s) => walkFiles(join(p.dir, 'skills', s, 'agents'))),
  ];
  for (const f of bodies) if (existsSync(f)) for (const m of readText(f).matchAll(SCRIPT_REF_RE)) {
    if (!refd.has(m[1])) refd.set(m[1], new Set());
    refd.get(m[1]).add(rel(f));
  }
  for (const [name, sources] of refd) {
    const copy = join(p.dir, 'scripts', name);
    const canonical = join(ROOT, 'scripts', name);
    const sourceList = [...sources].join(', ');
    if (!existsSync(copy)) fail(`${p.name}: ${sourceList} references \${CLAUDE_PLUGIN_ROOT}/scripts/${name} but it is not bundled in this plugin`);
    else if (!existsSync(canonical)) fail(`${p.name}: ${sourceList} references bundled scripts/${name}, which has no canonical scripts/${name} at the repo root`);
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
//      code-ops-docs/40 Engineering/Handbook/commands/<plugin>.md, and
//   b) a qualified `/<plugin>:<skill>` reference in the README router table.
// The reverse also has to hold: every `### `/<plugin>:<skill>`` heading must name a real skill.
const handbookDir = join(ROOT, 'code-ops-docs', '40 Engineering', 'Handbook', 'commands');
if (existsSync(handbookDir)) {
  // Router table: the `## The task → command router` section of the index, sliced off at the
  // next `##` heading so the per-plugin reference list below it does not count as "in the router".
  const routerReadmePath = join(handbookDir, 'README.md');
  let routerText = null;
  let routerReadmeFull = null;
  if (!existsSync(routerReadmePath)) {
    fail(`handbook: missing ${rel(routerReadmePath)} (the command router index)`);
  } else {
    const rr = readText(routerReadmePath);
    routerReadmeFull = rr;
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

  // ---- 15. "Per-plugin command references" bullet count parity -----------
  // Each bullet in that section reads `[<plugin>.md](<plugin>.md) — **N commands**: ...`;
  // N must match the plugin's actual skill count, the same drift class as the root
  // README "(N skills)" count (check 4) but for the handbook's own front door.
  if (routerReadmeFull !== null) {
    for (const p of plugins) {
      const lineRe = new RegExp(`\\[${escapeRe(p.name)}\\.md\\][^\\n]*`, 'm');
      const lineMatch = routerReadmeFull.match(lineRe);
      if (!lineMatch) {
        fail(`handbook: ${rel(routerReadmePath)} has no per-plugin bullet line for "${p.name}.md" in "Per-plugin command references"`);
        continue;
      }
      const countMatch = lineMatch[0].match(/\*\*(\d+)\s+commands\*\*/);
      if (!countMatch) {
        fail(`handbook: ${rel(routerReadmePath)} bullet for "${p.name}.md" has no "**N commands**" count`);
        continue;
      }
      const declared = Number(countMatch[1]);
      if (declared !== p.skills.length)
        fail(`handbook: ${rel(routerReadmePath)} says "${p.name}.md" has **${declared} commands** but ${p.name} actually has ${p.skills.length} skill(s) — update the count`);
    }
  }
}

// ---- 21. handbook techniques index parity -------------------------------------
// code-ops-docs/40 Engineering/Handbook/README.md's techniques list is the only index of code-ops-docs/40 Engineering/Techniques/. A page
// added without a list entry is written and unread; an entry left behind by a deleted or
// renamed page is a dead link in the handbook's front door; and the written-out count in the
// "N techniques" claim is a third copy of the same fact that drifts independently of both.
// Guarded on both paths existing, so the plugin-fixture evals (which ship no docs/ tree) are
// unaffected.
{
  const hbReadmePath = join(ROOT, 'code-ops-docs', '40 Engineering', 'Handbook', 'README.md');
  const techDir = join(ROOT, 'code-ops-docs', '40 Engineering', 'Techniques');
  if (existsSync(hbReadmePath) && existsSync(techDir)) {
    // Built, not listed: a hand-written table silently stops recognizing the correct count once
    // code-ops-docs/40 Engineering/Techniques/ outgrows it, and the operator is then told to add a count that is already
    // there. Units and tens generate every value through ninety-nine.
    const UNITS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
      'seventeen', 'eighteen', 'nineteen'];
    const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const NUMBER_WORDS = {};
    UNITS.forEach((w, i) => { NUMBER_WORDS[w] = i + 1; });
    TEENS.forEach((w, i) => { NUMBER_WORDS[w] = i + 10; });
    TENS.forEach((tw, ti) => {
      const base = (ti + 2) * 10;
      NUMBER_WORDS[tw] = base;
      UNITS.forEach((uw, ui) => { NUMBER_WORDS[`${tw}-${uw}`] = base + ui + 1; });
    });
    const files = readdirSync(techDir).filter((f) => f.endsWith('.md')).sort();
    const text = readText(hbReadmePath);
    // Scope the link scan to the techniques list block itself — from its bold heading to the next
    // blank-line-delimited section. A cross-reference elsewhere in the page must not satisfy the
    // index requirement, because the list is what the handbook's front door actually presents.
    const listStart = text.indexOf('**Techniques');
    let listBlock = '';
    if (listStart !== -1) {
      const after = text.slice(listStart);
      const nl = after.indexOf('\n');
      const body = nl === -1 ? '' : after.slice(nl + 1);
      const end = body.search(/\n\s*\n/);
      listBlock = end === -1 ? body : body.slice(0, end);
    }
    const listed = new Set();
    for (const m of listBlock.matchAll(/\.\.\/Techniques\/([A-Za-z0-9._-]+\.md)/g)) listed.add(m[1]);
    if (listStart === -1)
      fail(`handbook: ${rel(hbReadmePath)} has no "**Techniques" list block — the index of code-ops-docs/40 Engineering/Techniques/ is missing`);

    for (const f of files)
      if (!listed.has(f))
        fail(`handbook: code-ops-docs/40 Engineering/Techniques/${f} has no entry in the techniques list of ${rel(hbReadmePath)} — an unindexed technique page is written and unread`);
    for (const f of [...listed].sort())
      if (!existsSync(join(techDir, f)))
        fail(`handbook: ${rel(hbReadmePath)} links ../Techniques/${f}, which does not exist — remove or repoint the entry`);

    // Two failure modes, reported apart: no count word at all, versus a count word the vocabulary
    // does not recognize. The second should be unreachable below 100 now that the words are
    // generated, so seeing it means the claim itself is malformed, not that the table is short.
    const words = [...text.matchAll(/\b([a-z]+(?:-[a-z]+)?)\s+techniques\b/gi)].map((m) => m[1].toLowerCase());
    const claims = words.filter((w) => w in NUMBER_WORDS);
    // Number-shaped: either half of a hyphenated word is a known number word (`thirty-eleven`),
    // or the word names a magnitude the vocabulary stops short of (`hundred`, `thousand`).
    const numberShaped = words.filter((w) => !(w in NUMBER_WORDS)
      && (w.split('-').some((part) => part in NUMBER_WORDS) || /^(hundred|thousand|million)$/.test(w)));
    if (claims.length === 0 && numberShaped.length > 0)
      fail(`handbook: ${rel(hbReadmePath)} states a "${numberShaped[0]} techniques" count, which is not a recognized written-out number (expected "${files.length}" spelled out)`);
    else if (claims.length === 0)
      fail(`handbook: ${rel(hbReadmePath)} states no written-out "N techniques" count (expected "${files.length}" spelled out)`);
    else for (const w of claims)
      if (NUMBER_WORDS[w] !== files.length)
        fail(`handbook: ${rel(hbReadmePath)} claims "${w} techniques" but code-ops-docs/40 Engineering/Techniques/ holds ${files.length} page(s) — update the count`);
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

// ---- 12. agent model floors -------------------------------------------------
// The verification core (verifier, refutation-mode reviewers/tracers) is only as strong
// as the model tier behind it. Each bundled agent declares a `model:` alias; this floor
// table makes a downgrade a VISIBLE diff (the floor must be edited in the same change)
// instead of a silent frontmatter tweak. Also keeps the handbook's "(model: `X`)"
// annotations in code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md in sync with the frontmatter.
//
// The ordering comes from scripts/model-tiers.mjs so the gate and the provider-agnostic
// doctrine (frontier > strong > mid) cannot describe different ladders. Frontmatter still
// declares Anthropic aliases, because Claude Code reads that field directly; the canonical
// rung is what the other host renderers translate.
const MODEL_TIER = Object.fromEntries(
  Object.entries(CLAUDE_ALIAS_TIER).map(([alias, tier]) => [alias, TIER_RANK[tier]]),
);
const MODEL_ALIASES = Object.keys(MODEL_TIER).join('|');
const AGENT_MODEL_FLOORS = {
  'rigor/verifier': 'opus',
  'rigor/tracer': 'opus',
  'code-ops-suite/reviewer': 'opus',
  'privacy-opsec-suite/privacy-reviewer': 'opus',
  'researcher/claim-checker': 'sonnet',
  'code-ops-suite/explorer': 'haiku',
  'privacy-opsec-suite/explorer': 'haiku',
  'researcher/gatherer': 'haiku',
};
const agentModelByName = new Map();
for (const p of plugins) {
  const agentsDir = join(p.dir, 'agents');
  if (!existsSync(agentsDir)) continue;
  for (const f of readdirSync(agentsDir)) {
    if (!f.endsWith('.md')) continue;
    const fm = readText(join(agentsDir, f)).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const nm = fm && fm[1].match(/^name:[ \t]*(\S+)/m);
    const md = fm && fm[1].match(/^model:[ \t]*(\S+)/m);
    const agentKey = `${p.name}/${nm ? nm[1] : f.slice(0, -3)}`;
    if (!md) { fail(`${agentKey}: agents/${f} has no frontmatter model: field — declare the tier explicitly`); continue; }
    agentModelByName.set(agentKey, md[1]);
    const floor = AGENT_MODEL_FLOORS[agentKey];
    if (floor === undefined) { fail(`${agentKey}: not in AGENT_MODEL_FLOORS — add it with a deliberate tier floor`); continue; }
    if (!(md[1] in MODEL_TIER)) { fail(`${agentKey}: model "${md[1]}" is not a known tier alias (${MODEL_ALIASES})`); continue; }
    if (MODEL_TIER[md[1]] < MODEL_TIER[floor])
      fail(`${agentKey}: model "${md[1]}" is below its declared floor "${floor}" — downgrading the verification core requires editing AGENT_MODEL_FLOORS in the same change`);
  }
}
{
  const tradeoffs = join(ROOT, 'code-ops-docs', '40 Engineering', 'Techniques', 'subagent-trade-offs.md');
  if (existsSync(tradeoffs)) {
    const lines = readText(tradeoffs).split('\n');
    for (let i = 0; i < lines.length; i++) {
      // The doc writes shorthand plugin prefixes ("code-ops `explorer`"); resolve the
      // prefix to a real plugin name so the two `explorer` agents cannot collide.
      for (const m of lines[i].matchAll(/\*\*([a-z-]+) `([a-z-]+)`\*\*[^(]*\(model: `([a-z-]+)`/g)) {
        const pluginName = plugins.some((p) => p.name === m[1]) ? m[1]
          : plugins.some((p) => p.name === `${m[1]}-suite`) ? `${m[1]}-suite` : null;
        if (!pluginName) continue;
        const actual = agentModelByName.get(`${pluginName}/${m[2]}`);
        if (actual && actual !== m[3])
          fail(`code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md:${i + 1}: annotates ${pluginName}/${m[2]} as (model: \`${m[3]}\`) but its frontmatter says "${actual}" — sync the doc`);
      }
    }
  }
}

// ---- 13. producer register self-check wiring ---------------------------------
// The register-producing skills must gate their own Done-when on revalidate-register
// (the producer-side anchor gate) — this guard keeps that wiring from silently
// regressing in a later edit, the same pattern as the runtime-script checks.
const PRODUCER_SELFCHECK = [
  'plugins/rigor/skills/bug-hunt/SKILL.md',
  'plugins/rigor/skills/quality-scan/SKILL.md',
  'plugins/rigor/skills/consistency-closure/SKILL.md',
  'plugins/code-ops-suite/skills/codebase-audit/SKILL.md',
];
for (const rel of PRODUCER_SELFCHECK) {
  const f = join(ROOT, ...rel.split('/'));
  if (!existsSync(f)) { fail(rel + ': producer skill missing (PRODUCER_SELFCHECK)'); continue; }
  const dw = readText(f).split(/^##[ 	]+Done when/im)[1] ?? '';
  if (!dw.includes('revalidate-register.mjs'))
    fail(rel + ': Done-when no longer runs revalidate-register.mjs — the producer-side anchor gate must not silently regress');
}

// ---- 14. shared doctrine passages: intentional duplication gets a drift gate ----
// Each entry pins a CORE span (a clause or sentence, free of per-plugin § references) that
// must appear byte-identically in every listed file. Rolling out a doctrine change means
// editing every copy in the same commit — this check makes a partial rollout fail CI
// instead of silently diverging (the enabler for inlining rules at point of use).
const CONVS = (...names) => names.map((p) => `plugins/${p}/CONVENTIONS.md`);
const SHARED_PASSAGES = [
  { id: 'fanout-throttle', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "a broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run; do not rely on the platform's concurrency cap as the limiter" },
  { id: 'skim-then-deepen', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end' },
  { id: 'skipped-set', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: "take the union of every slice's skipped/traced note — a high-risk area that no slice covered is itself a finding (a coverage gap), not silence" },
  { id: 'intent-annotation', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: "read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior" },
  { id: 'locate-the-handler', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'must actively LOCATE the would-be handler — the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement' },
  { id: 'headless-default', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'do not block: auto-scope from the repo, proceed on the safe default' },
  { id: 'headless-defer', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'are deferred and reported, never silently applied — and surface every decision and critical finding in the final report instead of pausing' },
  { id: 'circuit-breaker-core', files: CONVS('code-ops-suite', 'rigor'),
    text: 'stop the fix loop — a cascading cluster is evidence of an architectural problem, not a bug collection' },
  { id: 'circuit-breaker-checkpoint', files: CONVS('code-ops-suite', 'rigor'),
    text: 'present options at a checkpoint instead of attempting the next fix; in a headless run, defer the remaining cluster and report it' },
  { id: 'non-secret-anchor', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value); if no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.' },
  { id: 'terminal-forms', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'A consumed item ends in exactly one pinned terminal form — `closed-with-proof <commit/PR>`, `deferred-with-reason <reason>`, or `OBSOLETE-AT <sha>` — and never silently disappears' },
  { id: 'read-once', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it' },
  { id: 'prefilter-first', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full' },
  { id: 'repanel-skip', files: CONVS('code-ops-suite', 'rigor'),
    text: 'is NOT re-paneled — the receipts are the verdict; any drift forces a fresh panel. Hand each panelist the finding block under test plus the cited region (anchor ±30 lines) inline — never the full register' },
  { id: 'map-once', files: CONVS('code-ops-suite', 'rigor'),
    text: 'hand the verified context artifact to every operative brief; operatives consult it first and use search only to go deeper than it reaches, never to re-derive layout or find definitions it already lists' },
  { id: 'always-gated-core', files: ['plugins/code-ops-suite/CONVENTIONS.md', 'plugins/code-ops-suite/skills/everything/SKILL.md'],
    text: '**Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge' },
  { id: 'operative-failure', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "failed dispatch, not a weak signal — never synthesize around a missing report or fill its gap from the orchestrator's own assumptions" },
  { id: 'failure-ladder', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'redispatch once with a tightened, smaller brief; then escalate at the next checkpoint' },
  { id: 'ledger-atomicity', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'The row is written **at dispatch time**, atomically with the dispatch call itself — never a turn earlier or later — because a row written before its dispatch is a phantom indistinguishable from a hung operative' },
  { id: 'report-persistence', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: "Every operative report is written to the run's artifact folder in the turn it arrives, before any other work — a report that exists only in the conversation is one blocked turn away from being lost." },
  { id: 'report-shape-gate', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'A brief that never reached its operative is indistinguishable in the dispatch record from a completed dispatch until the report is read, so gate every report on shape — expected sections present, non-empty, evidence attached — before its unit counts as covered.' },
  { id: 'tier-boundary', files: CONVS('code-ops-suite', 'rigor'),
    text: "an operative labels a finding CONFIRMED only when an executed repro or trace appears in its own transcript; a finding argued from static reading caps at PROBABLE, and promotion to CONFIRMED is the lead's act on executed evidence" },
  { id: 'panel-lens-diversity', files: CONVS('code-ops-suite', 'rigor'),
    text: "Panelists get **distinct lenses** (correctness, configuration-reading, reachability), never N identical skeptics — identical readers repeat one another's misreads, and diversity catches what redundancy cannot." },
  { id: 'tier-floor-carrier', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'On a host that ignores agent `model:` frontmatter the lead acknowledges that printed floor table and routes every dispatch at or above its floor by hand — a below-floor dispatch is a doctrine violation that `run-cost-audit` records as a `tier-routing` FAIL.' },
  { id: 'last-paragraph-check', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Before ending a turn, read the last paragraph: if it is a plan, an unasked question, or a promise of work not yet done, do that work now.' },
  { id: 'scope-discipline', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'A pre-existing bug, performance concern, or behavior the task does not name is reported as a follow-up, never fixed, optimized, or extended in this change unless the requested behavior cannot work without it.' },
  { id: 'ordered-objective', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: 'The objective is ordered: correctness and the safety floor, then module boundaries, then measured performance on hot paths, then readability, then size. Fewer lines wins only between candidates equal on the first four.' },
  { id: 'ladder-core', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite'),
    text: "Before writing code, climb the ladder: does it need to exist (scope is the request); does it exist here (search before you write); does the standard library, the platform, or an installed dependency do it (verified against current docs, never from memory); does it fit inside the owning module (extend before you add a file); extract only on evidence (a second caller, a unit that needs its own test, or a file past the repository's own size norm); then write the minimum edge-case-correct implementation." },
  { id: 'writing-standard-core', files: CONVS('code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'),
    text: 'Write to the house writing standard: one term per concept, active voice, one instruction per sentence, 20 words for instructions and 25 for explanation. Identifiers, paths, commands, and quoted output count as one word and are never reworded to fit a limit.' },
];

// Same drift gate as SHARED_PASSAGES, but for the operative agent definitions
// (plugins/*/agents/*.md) rather than CONVENTIONS.md — these carry their own
// near-identical doctrine clauses (escalate-don't-guess, redact-secrets,
// dense/evidence-cited-report) with no other mechanical backstop.
const AGENTS = (...paths) => paths;
const AGENT_SHARED_PASSAGES = [
  { id: 'agent-escalate-dont-guess', files: AGENTS(
      'plugins/code-ops-suite/agents/explorer.md', 'plugins/code-ops-suite/agents/reviewer.md',
      'plugins/privacy-opsec-suite/agents/explorer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/researcher/agents/claim-checker.md', 'plugins/researcher/agents/gatherer.md',
      'plugins/rigor/agents/tracer.md', 'plugins/rigor/agents/verifier.md'),
    text: 'return the open question to the orchestrator instead of guessing' },
  { id: 'agent-redact-secrets-full', files: AGENTS(
      'plugins/code-ops-suite/agents/explorer.md', 'plugins/researcher/agents/claim-checker.md',
      'plugins/researcher/agents/gatherer.md', 'plugins/rigor/agents/tracer.md'),
    text: 'Redact any secrets/PII to `<REDACTED:reason>`; never reproduce a secret value.' },
  { id: 'agent-redact-secrets-short', files: AGENTS(
      'plugins/code-ops-suite/agents/reviewer.md', 'plugins/rigor/agents/verifier.md'),
    text: 'Redact secrets/PII.' },
  { id: 'agent-dense-evidence-cited', files: AGENTS(
      'plugins/code-ops-suite/agents/reviewer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/researcher/agents/claim-checker.md', 'plugins/rigor/agents/verifier.md', 'plugins/rigor/agents/tracer.md'),
    text: 'dense and evidence-cited' },
  { id: 'agent-batch-tool-calls', files: AGENTS(
      'plugins/code-ops-suite/agents/explorer.md', 'plugins/code-ops-suite/agents/reviewer.md',
      'plugins/privacy-opsec-suite/agents/explorer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/researcher/agents/claim-checker.md', 'plugins/researcher/agents/gatherer.md',
      'plugins/rigor/agents/tracer.md', 'plugins/rigor/agents/verifier.md'),
    text: 'Before each tool round, list what you still need, then request every item that does not depend on another result in that one response.' },
  { id: 'agent-tier-boundary', files: AGENTS(
      'plugins/code-ops-suite/agents/reviewer.md', 'plugins/privacy-opsec-suite/agents/privacy-reviewer.md',
      'plugins/rigor/agents/tracer.md', 'plugins/rigor/agents/verifier.md'),
    text: "label a finding CONFIRMED only when an executed repro or trace appears in your own transcript; a finding argued from static reading caps at PROBABLE, and promoting it is the orchestrator's call" },
];
for (const p of [...SHARED_PASSAGES, ...AGENT_SHARED_PASSAGES]) {
  for (const f of p.files) {
    const abs = join(ROOT, ...f.split('/'));
    if (!existsSync(abs)) { fail(`SHARED_PASSAGES ${p.id}: listed file missing: ${f}`); continue; }
    if (!readText(abs).includes(p.text))
      fail(`${f}: shared passage "${p.id}" is absent or has drifted — doctrine cores are edited in every listed copy in the same commit (SHARED_PASSAGES in this linter)`);
  }
}

// ---- 16. advisory: root scripts with no reference under evals/ (never gates) ----
// Mirrors revalidate-register.mjs's --dispatch-ledger block: this is informational only
// and must never affect the exit code. A script with zero evals/ hits is a candidate for
// a regression eval, not a structural problem.
function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}
{
  const evalsDir = join(ROOT, 'evals');
  const evalsContent = walkFiles(evalsDir).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const scriptsDir = join(ROOT, 'scripts');
  if (existsSync(scriptsDir)) {
    for (const f of readdirSync(scriptsDir)) {
      if (!f.endsWith('.mjs')) continue;
      if (!evalsContent.includes(f))
        warn(`scripts/${f} has no reference under evals/ — consider a regression eval`);
    }
  }
}

// ---- 17. skill-composition.md edge resolution -------------------------------
// The composition map's table rows ("From skill" / "Invokes" columns) name
// `<plugin>:<skill>` edges in backticks. Each side must resolve to a real
// plugins/<plugin>/skills/<skill>/ directory — the same drift class as the
// qualified-reference check (5) above, but for the standalone doc instead of a
// SKILL.md body, since nothing else re-derives this map from the skill tree.
// Scope note: this check deliberately validates rows PAGE-WIDE — any table row
// anywhere on the page must name resolvable skills. Check 22 below is narrower on
// purpose: it derives the edge set only from the rows under "## The edges", and
// separately refuses edge-shaped rows parked outside that section. Both loops skip
// fenced code blocks, so a markdown example on the page is not read as page structure.
{
  const compPath = join(ROOT, 'code-ops-docs', '40 Engineering', 'Techniques', 'skill-composition.md');
  if (existsSync(compPath)) {
    const lines = readText(compPath).split('\n');
    // A fenced example is illustration, not page structure, so its rows are skipped —
    // the same treatment check-doc-citations.mjs gives fences in its own line loop. The
    // page-wide scope outside fences is unchanged.
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s{0,3}```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (!line.trim().startsWith('|')) continue;
      if (/^\|[\s:-]+\|/.test(line)) continue; // header separator row (---|---)
      const cells = line.split('|');
      // "From skill" is cells[1], "Invokes" is cells[2] (cells[0] is the empty prefix before the first pipe).
      for (const cell of [cells[1], cells[2]]) {
        if (!cell) continue;
        for (const m of cell.matchAll(/`([a-z0-9-]+):([a-z0-9-]+)`/g)) {
          const [, pn, sn] = m;
          const target = pluginByName.get(pn);
          if (!target) fail(`${rel(compPath)}:${i + 1}: edge references unknown plugin "${pn}" in "${pn}:${sn}"`);
          else if (!target.skills.includes(sn))
            fail(`${rel(compPath)}:${i + 1}: edge references unresolvable skill "${pn}:${sn}" — no plugins/${pn}/skills/${sn}/ directory`);
        }
      }
    }
  }
}

// ---- 18. eval-wired-to-CI gate ----------------------------------------------
// (check name: `eval-wired-to-ci`)
// A regression eval that isn't invoked in CI provides no real backstop — it can silently
// rot with nobody noticing it stopped running. For every evals/<name>/ directory that
// contains a run.mjs, the literal string `node evals/<name>/run.mjs` must appear somewhere
// in .github/workflows/validate.yml. Judgment-eval dirs without a run.mjs (e.g. ones that
// are only ever driven by evals/score.mjs against an ANSWER_KEY) are naturally out of scope
// — the glob keys on run.mjs existing, not on the directory existing.
{
  const evalsRootDir = join(ROOT, 'evals');
  const workflowPath = join(ROOT, '.github', 'workflows', 'validate.yml');
  if (!existsSync(workflowPath)) {
    fail(`missing ${rel(workflowPath)} — cannot verify evals are wired into CI`);
  } else {
    const workflowText = readText(workflowPath);
    for (const name of listDirs(evalsRootDir)) {
      const runPath = join(evalsRootDir, name, 'run.mjs');
      if (!existsSync(runPath)) continue; // no run.mjs -> not an eval this check tracks
      const needle = `node evals/${name}/run.mjs`;
      if (!workflowText.includes(needle))
        fail(`evals/${name}/run.mjs exists but is not invoked in ${rel(workflowPath)} (expected the literal string "${needle}")`);
    }
  }
}

// ---- 23. repository CI dependency-policy wiring ----------------------------
// This rule belongs to the marketplace repository, not to the portable plugin linter.
// Synthetic consumers omit marketplace.name and therefore do not inherit this repo's CI files.
if (mp?.name === 'code-ops') {
  const required = [
    '.node-version',
    '.github/actions-lock.json',
    '.github/dependabot.yml',
    'scripts/check-action-pins.mjs',
  ];
  for (const path of required) if (!existsSync(join(ROOT, ...path.split('/')))) fail(`missing repository CI dependency-policy file: ${path}`);

  const workflowPath = join(ROOT, '.github', 'workflows', 'validate.yml');
  if (!existsSync(workflowPath)) fail('missing .github/workflows/validate.yml — cannot verify action-pin gate wiring');
  else {
    const needle = 'node scripts/check-action-pins.mjs';
    const count = readText(workflowPath).split(needle).length - 1;
    if (count !== 2) fail(`.github/workflows/validate.yml must invoke "${needle}" once per platform job (expected 2, found ${count})`);
  }
}

// ---- 19. auto-merge denylist ------------------------------------------------
// SHARED_PASSAGES 'always-gated-core' pins "**Never auto-merge" as doctrine; this backs it
// with a mechanical scan of the surfaces that could actually WIRE auto-merge into a
// workflow, script, or hook: plugins/**/*.mjs, scripts/*.mjs, .github/workflows/*.yml,
// plugins/**/hooks/*.json. .md files are deliberately excluded — doctrine prose legitimately
// talks ABOUT never auto-merging.
//
// The denylist tokens below are built via concatenation — never written as a single
// contiguous literal anywhere in this file, including in the fail messages (which reference
// the token variables via interpolation rather than retyping them) — so this check's own
// source in scripts/lint-plugins.mjs can never trip its own denylist when scripts/*.mjs is
// scanned. Same self-exclusion problem scan-ai-tells.mjs sidesteps by simply never
// containing the tells it looks for; here the tells ARE representable in code, so they're
// split instead.
{
  const TOK_GH_MERGE = 'gh' + ' pr ' + 'merge';
  const TOK_AUTO_FLAG = '--' + 'auto';
  const TOK_AUTO_MERGE_KEY = 'auto' + '_merge';
  const TOK_ENABLE_AUTOMERGE = 'enablePullRequestAuto' + 'Merge';
  const autoFlagRe = new RegExp(escapeRe(TOK_AUTO_FLAG) + '(?![a-zA-Z0-9-])');
  const autoMergeKeyRe = new RegExp(escapeRe(TOK_AUTO_MERGE_KEY) + '\\s*[:=]\\s*(true|"true"|\'true\'|1|yes)\\b', 'i');

  const autoMergeTargets = [];
  for (const f of walkFiles(join(ROOT, 'plugins'))) {
    const r = f.replaceAll('\\', '/');
    if (r.endsWith('.mjs') || (r.endsWith('.json') && /\/hooks\/[^/]+\.json$/.test(r))) autoMergeTargets.push(f);
  }
  const amScriptsDir = join(ROOT, 'scripts');
  if (existsSync(amScriptsDir)) for (const f of readdirSync(amScriptsDir)) if (f.endsWith('.mjs')) autoMergeTargets.push(join(amScriptsDir, f));
  const amWorkflowsDir = join(ROOT, '.github', 'workflows');
  if (existsSync(amWorkflowsDir)) for (const f of readdirSync(amWorkflowsDir)) if (f.endsWith('.yml')) autoMergeTargets.push(join(amWorkflowsDir, f));

  for (const f of autoMergeTargets) {
    const lines = readText(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(TOK_GH_MERGE) && autoFlagRe.test(line))
        fail(`${rel(f)}:${i + 1}: auto-merge denylist — "${TOK_GH_MERGE}" combined with "${TOK_AUTO_FLAG}" on the same line (never auto-merge)`);
      if (autoMergeKeyRe.test(line))
        fail(`${rel(f)}:${i + 1}: auto-merge denylist — "${TOK_AUTO_MERGE_KEY}" set to a true-ish value (never auto-merge)`);
      if (line.includes(TOK_ENABLE_AUTOMERGE))
        fail(`${rel(f)}:${i + 1}: auto-merge denylist — "${TOK_ENABLE_AUTOMERGE}" referenced (never auto-merge)`);
    }
  }
}

// ---- 20. host-neutral standards contract parity ------------------------------
// The repo's standards contract ships under two names because hosts read different files:
// Claude Code reads CLAUDE.md; Codex reads AGENTS.md; opencode reads AGENTS.md and only
// falls back to CLAUDE.md when AGENTS.md is ABSENT; Grok Build reads both. Shipping both
// files therefore means a divergence is invisible on exactly the hosts that read the other
// copy — which is how the writing-standard section lived in CLAUDE.md alone, unseen by
// Codex and opencode. They are one document under two names, so this pins them
// byte-identically rather than trusting anyone to remember the second edit.
{
  const claudeMd = join(ROOT, 'CLAUDE.md');
  const agentsMd = join(ROOT, 'AGENTS.md');
  if (!existsSync(claudeMd)) fail('CLAUDE.md is missing — it is the repo standards contract Claude Code reads');
  else if (!existsSync(agentsMd)) fail('AGENTS.md is missing — Codex and opencode read it instead of CLAUDE.md');
  else if (readText(claudeMd) !== readText(agentsMd)) {
    fail('CLAUDE.md and AGENTS.md have diverged — they are one contract under two names, and hosts that read AGENTS.md (Codex, opencode) silently lose whatever only CLAUDE.md carries. Copy CLAUDE.md over AGENTS.md in the same commit.');
  }
}

// ---- 22. skill-composition.md edge completeness ------------------------------
// (check name: `composition-map-parity`)
// Check 17 proves each named edge RESOLVES; it never proves the map matches the tree.
// This one closes that gap in both directions, using the page's own derivation rule:
// every qualified `<plugin>:<skill>` reference (leading slash optional) in a
// plugins/*/skills/*/SKILL.md, excluding the skill's own name, must have a table row,
// and every table row must have such a reference. A skill's self-declaring "Invoked as"
// line needs no special case: the only reference it carries is the skill's own name,
// which the self-exclusion already drops. Guarded on the page existing so a checkout
// without it still lints. The table scan derives edges only from the rows under the
// page's "## The edges" heading (subheadings nested below it stay inside the section),
// and an edge-shaped row anywhere else on the page fails outright, so the scoping is
// not an escape hatch. Fenced code blocks are skipped: an example is not structure.
{
  const compPath = join(ROOT, 'code-ops-docs', '40 Engineering', 'Techniques', 'skill-composition.md');
  if (existsSync(compPath)) {
    const known = new Set();
    for (const p of plugins) for (const s of p.skills) known.add(`${p.name}:${s}`);

    // Edges present in the skill tree.
    const inTree = new Map(); // "from>to" -> "path:line"
    for (const p of plugins) {
      for (const s of p.skills) {
        const skPath = join(p.dir, 'skills', s, 'SKILL.md');
        if (!existsSync(skPath)) continue;
        const self = `${p.name}:${s}`;
        const lines = readText(skPath).split('\n');
        for (let i = 0; i < lines.length; i++) {
          for (const m of lines[i].matchAll(/\/?([a-z0-9-]+):([a-z0-9-]+)/g)) {
            const target = `${m[1]}:${m[2]}`;
            if (!known.has(target) || target === self) continue;
            const key = `${self}>${target}`;
            if (!inTree.has(key)) inTree.set(key, `${rel(skPath)}:${i + 1}`);
          }
        }
      }
    }

    // Edges claimed by the table under "## The edges" — the section the page declares as
    // the map. Rows outside it (a future second table) are not edges. To keep that scoping
    // from becoming an escape hatch, an edge-SHAPED row (backticked qualified skill names
    // in both of the first two cells) found outside the section fails outright instead of
    // going quiet: it is either a relocated edge or a row that should reword its cells.
    const inTable = new Map(); // "from>to" -> line number
    const compLines = readText(compPath).split('\n');
    let inEdges = false;
    let edgesLevel = 0;
    // Fenced blocks are examples, not structure: a heading or an edge-shaped row inside
    // one must not open, close, or populate the edges section.
    let inFence = false;
    for (let i = 0; i < compLines.length; i++) {
      const line = compLines[i];
      if (/^\s{0,3}```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        // A subheading nested under "## The edges" stays inside the section; only a
        // heading at the same or a higher level closes it.
        const level = heading[1].length;
        // A degenerate second "The edges" nested inside the first must not deepen the
        // level, or a later sibling subheading would close the section early.
        if (heading[2].trim().toLowerCase() === 'the edges') {
          if (!inEdges) edgesLevel = level;
          inEdges = true;
        } else if (inEdges && level <= edgesLevel) {
          inEdges = false;
        }
        continue;
      }
      if (!line.trim().startsWith('|')) continue;
      if (/^\|[\s:-]+\|/.test(line)) continue;
      const cells = line.split('|');
      const pick = (cell) => {
        const m = cell ? cell.match(/`([a-z0-9-]+):([a-z0-9-]+)`/) : null;
        return m ? `${m[1]}:${m[2]}` : null;
      };
      const from = pick(cells[1]);
      const to = pick(cells[2]);
      if (!from || !to) continue;
      if (!inEdges) {
        fail(`${rel(compPath)}:${i + 1}: edge-shaped row outside the edges section — "${from}" -> "${to}" sits outside "## The edges", where the map is derived; move it in or reword the cells`);
        continue;
      }
      const key = `${from}>${to}`;
      if (inTable.has(key)) fail(`${rel(compPath)}:${i + 1}: duplicate edge row "${from}" -> "${to}"`);
      inTable.set(key, i + 1);
    }

    for (const [key, where] of inTree) {
      if (!inTable.has(key)) {
        const [from, to] = key.split('>');
        fail(`${where}: qualified reference "${to}" from "${from}" has no edge row in ${rel(compPath)}`);
      }
    }
    for (const [key, ln] of inTable) {
      if (!inTree.has(key)) {
        const [from, to] = key.split('>');
        fail(`${rel(compPath)}:${ln}: edge row "${from}" -> "${to}" matches no qualified reference in any SKILL.md`);
      }
    }
  }
}

// ---- report ----------------------------------------------------------------
for (const w of warnings) console.log(`  advisory: ${w}`);
if (errors.length) {
  console.error(`\nFAIL — ${errors.length} structural problem(s):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}
const totalCommands = plugins.reduce((n, p) => n + p.skills.length, 0);
console.log(`OK — ${plugins.length} plugins, ${totalCommands} commands (${allSlugs.size} unique skills), no structural problems.`);
