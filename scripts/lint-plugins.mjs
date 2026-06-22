#!/usr/bin/env node
// Structural linter for the code-ops plugin marketplace.
//
// Zero-dependency. Run from anywhere: `node scripts/lint-plugins.mjs`.
// Exits non-zero on any structural problem (CI gate). It deliberately checks
// only mechanical invariants that humans get wrong — the kind of drift the
// suite's own `doc-alignment` / `rigor` skills preach catching but that the
// marketplace had no automated backstop for:
//
//   1. Manifests parse; marketplace <-> plugin.json name/version agree; sources resolve.
//   2. Every README "(N skills)" count matches the real skills/ dir count, and
//      every skill slug is mentioned in its plugin README (discoverability).
//   3. Every SKILL.md has frontmatter `description:`, a `## Done when` section,
//      and references CONVENTIONS.md (the suite's completion + backbone contract).
//   4. Each plugin has the CONVENTIONS.md its skills reference.
//   5. Orchestrator skills only reference skills that actually exist (the bug
//      that shipped: full-sweep -> nonexistent `code-normalization`).
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

// Orchestrator skills invoke OTHER skills by name; their references must resolve.
const ORCHESTRATOR_SKILLS = new Set(['full-sweep', 'everything', 'rigor-sweep']);
// Hyphenated, slug-shaped tokens that legitimately appear emphasized in an
// orchestrator but are NOT skills (track names, automation levels, plugin names,
// opsec terms). Add here only after confirming the token is intentional.
const ORCH_TOKEN_ALLOWLIST = new Set([
  'assess-only', 'audit-only', 'auto-all', 'auto-safe', 'fail-closed',
  'code-ops-suite', 'privacy-opsec-suite',
]);
const SLUG_RE = /[a-z0-9]+(?:-[a-z0-9]+)+/; // a hyphenated lowercase token

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
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
function emphasizedSlugTokens(body) {
  const toks = new Set();
  for (const m of body.matchAll(/\*\*([a-z0-9-]+)\*\*/g)) if (SLUG_RE.test(m[1])) toks.add(m[1]);
  for (const m of body.matchAll(/`([a-z0-9-]+)`/g)) if (SLUG_RE.test(m[1])) toks.add(m[1]);
  return toks;
}

// ---- 1. marketplace + manifests --------------------------------------------
const mpPath = join(ROOT, '.claude-plugin', 'marketplace.json');
if (!existsSync(mpPath)) fail('missing .claude-plugin/marketplace.json');
const mp = existsSync(mpPath) ? readJSON(mpPath) : null;

const plugins = []; // { name, dir, manifest, skills, readme }
if (mp && Array.isArray(mp.plugins)) {
  for (const entry of mp.plugins) {
    if (typeof entry.source !== 'string') {
      warn(`marketplace entry "${entry.name}": non-local source, skipping path checks`);
      continue;
    }
    const dir = resolve(ROOT, entry.source);
    if (!existsSync(dir)) {
      fail(`marketplace entry "${entry.name}": source dir missing (${entry.source})`);
      continue;
    }
    const manPath = join(dir, '.claude-plugin', 'plugin.json');
    const manifest = existsSync(manPath) ? readJSON(manPath) : null;
    if (!manifest) {
      fail(`"${entry.name}": missing .claude-plugin/plugin.json`);
    } else {
      if (manifest.name !== entry.name)
        fail(`name mismatch: marketplace "${entry.name}" vs plugin.json "${manifest.name}"`);
      if (entry.version && manifest.version && entry.version !== manifest.version)
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
      skills: listDirs(join(dir, 'skills')),
      readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '',
    });
  }
} else if (mp) {
  fail('marketplace.json has no "plugins" array');
}

const allSlugs = new Set(plugins.flatMap((p) => p.skills));

// ---- 2/3/5. per-plugin: README mentions, SKILL.md structure, orchestrator refs
for (const p of plugins) {
  for (const slug of p.skills) {
    if (p.readme && !p.readme.includes(slug))
      fail(`${p.name}/README.md does not mention skill "${slug}"`);
  }
  for (const slug of p.skills) {
    const skPath = join(p.dir, 'skills', slug, 'SKILL.md');
    if (!existsSync(skPath)) {
      fail(`${p.name}/${slug}: missing SKILL.md`);
      continue;
    }
    const body = readFileSync(skPath, 'utf8');
    const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) fail(`${p.name}/${slug}: missing YAML frontmatter`);
    else if (!/\bdescription:\s*\S/.test(fm[1])) fail(`${p.name}/${slug}: frontmatter missing non-empty description`);
    if (fm) {
      // An unquoted scalar containing ": " (colon-space) or a trailing colon breaks
      // the YAML parser, so the frontmatter silently loads as EMPTY metadata at runtime.
      for (const raw of fm[1].split('\n')) {
        const line = raw.replace(/\r$/, '');
        const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]+(.+?)[ \t]*$/);
        if (!kv) continue;
        const val = kv[2];
        if (/^["'[{|>&*]/.test(val)) continue; // already quoted or block/flow scalar
        if (val.includes(': ') || /:$/.test(val))
          fail(`${p.name}/${slug}: frontmatter "${kv[1]}" has an unquoted colon — wrap the value in double quotes (breaks YAML; metadata silently dropped at runtime)`);
      }
    }
    if (!/##\s*Done when/i.test(body)) fail(`${p.name}/${slug}: missing "## Done when" section`);
    if (!body.includes('CONVENTIONS.md')) fail(`${p.name}/${slug}: does not reference CONVENTIONS.md`);

    if (ORCHESTRATOR_SKILLS.has(slug)) {
      for (const tok of emphasizedSlugTokens(body)) {
        if (!allSlugs.has(tok) && !ORCH_TOKEN_ALLOWLIST.has(tok))
          fail(`${p.name}/${slug}: references unknown skill-like token "${tok}" — not a skill slug (rename it, or add to ORCH_TOKEN_ALLOWLIST if intentional)`);
      }
    }
  }
}

// ---- 4. root README skill-count parity -------------------------------------
const rootReadmePath = join(ROOT, 'README.md');
if (existsSync(rootReadmePath)) {
  const rr = readFileSync(rootReadmePath, 'utf8');
  for (const p of plugins) {
    const re = new RegExp('`' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`[\\s\\S]{0,500}?\\((\\d+)\\s+skills\\)');
    const m = rr.match(re);
    if (!m) {
      warn(`root README: no "(N skills)" count found near \`${p.name}\``);
      continue;
    }
    if (Number(m[1]) !== p.skills.length)
      fail(`root README count for ${p.name}: says ${m[1]}, actual ${p.skills.length}`);
  }
} else {
  warn('no root README.md');
}

// ---- 6. bundled runtime scripts must match the canonical (copy-on-build) ----
// Skills invoke these via ${CLAUDE_PLUGIN_ROOT}/scripts/, so each must ship inside
// every plugin that references it and stay byte-identical to the repo-root source.
const RUNTIME_SCRIPTS = [
  { name: 'revalidate-register.mjs', plugins: ['code-ops-suite', 'privacy-opsec-suite', 'rigor'] },
  { name: 'scan-ai-tells.mjs', plugins: ['privacy-opsec-suite'] },
];
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

// ---- 7. no skill copy-pastes a long passage of its CONVENTIONS (drift guard) ----
// A skill restating a whole CONVENTIONS section drifts when that section is edited.
// Flag any 40+ contiguous-word run a skill shares verbatim with its CONVENTIONS;
// reference the section by number instead.
const DUP_NGRAM = 40;
const normWords = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
for (const p of plugins) {
  const convPath = join(p.dir, 'CONVENTIONS.md');
  if (!existsSync(convPath)) continue;
  const conv = normWords(readFileSync(convPath, 'utf8'));
  if (conv.length < DUP_NGRAM) continue;
  const grams = new Set();
  for (let i = 0; i + DUP_NGRAM <= conv.length; i++) grams.add(conv.slice(i, i + DUP_NGRAM).join(' '));
  for (const slug of p.skills) {
    const skPath = join(p.dir, 'skills', slug, 'SKILL.md');
    if (!existsSync(skPath)) continue;
    const w = normWords(readFileSync(skPath, 'utf8'));
    for (let i = 0; i + DUP_NGRAM <= w.length; i++) {
      if (grams.has(w.slice(i, i + DUP_NGRAM).join(' '))) {
        fail(`${p.name}/${slug}: copies a ${DUP_NGRAM}+ word passage verbatim from CONVENTIONS ('${w.slice(i, i + 8).join(' ')}...') — reference the section instead`);
        break;
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
console.log(`OK — ${plugins.length} plugins, ${allSlugs.size} skills, no structural problems.`);
