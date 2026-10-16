#!/usr/bin/env node
// Skill write-class classifier: which tools may a SKILL.md remove from itself?
//
// WHY: the frontmatter key `disallowed-tools` removes tools while a skill runs (Claude Code only).
// It cannot scope a write to one folder, so the only safe removals follow what the skill writes.
// A hand-made list drifts, so this script classifies every skill from its body and `--check` fails
// when the declared key differs from the class.
//
//   class     meaning                                          declared key
//   none      writes no file at all                            disallowed-tools: Edit, Write, NotebookEdit
//   artifact  writes only new artifacts (run files, registers) disallowed-tools: Edit, NotebookEdit
//   source    edits code or docs, or dispatches an editor      (no key)
//
//   node scripts/skill-write-class.mjs            print the table
//   node scripts/skill-write-class.mjs --check    exit 1 when a declared key differs from its class
//
// The rules favor the permissive class, so a misclassification never removes a tool a skill needs:
//   1. No read-only declaration (READ_ONLY) in the text: source.
//   2. A read-only declaration plus an editing signal (EDITS_SOURCE): source.
//   3. A read-only declaration plus a write-target signal (WRITES_ARTIFACT): artifact.
//   4. A read-only declaration and neither signal: none.
// OVERRIDES wins over all four rules for a skill where a signal misleads; each entry names why.
// Exit: 0 = clean, 1 = a declared key differs from its class, 2 = usage error.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CLASS_LINES = {
  none: 'Edit, Write, NotebookEdit',
  artifact: 'Edit, NotebookEdit',
  source: null,
};

// The skill states that it does not change source. A skill without this text is source.
export const READ_ONLY = /writes? no code|review only|discovery only|specification only|\bread-only\b|never edits? (?:the )?(?:source|code)|no code changed|writes nothing|no implementation/i;

// The skill dispatches an operative that edits, or applies fixes itself.
export const EDITS_SOURCE = /\b(?:dispatch(?:es|ed)?|spawns?|launch(?:es)?|runs?|invokes?) [^.]{0,40}\b(?:implementer|fixer)\b|\bsafe fixes\b|\bapplies (?:only )?(?:the |each )?(?:safe )?(?:fix|patch)/i;

// The skill changes a file that already exists: docs it reconciles or repairs, an artifact it
// updates in place, or a prior register it stamps. Edit is the right tool for these.
export const EDITS_EXISTING = /\breconcil\w* (?:\w+ ){0,3}into one source of truth|\brepairs?\b|\b(?:updated?|edited|rewritten|stamped) in place\b|\bstamps? (?:a |an |each )?(?:dropped |stale )?entr|\bedits? (?:the )?(?:docs?|files?|atlas|vault|contract)\b|\bedited notes\b/i;

// The skill names somewhere it writes: a run folder, a named register or report file, a receipt,
// or a dispatched mech or verifier (both leave receipts). The negative lookahead skips the fixed
// files a skill only reads.
export const WRITES_ARTIFACT = /80 Runs|run folder|\b(?!(?:CONVENTIONS|AGENTS|CLAUDE|README|CHANGELOG|SKILL)\.md)[A-Z][A-Z_]{3,}\.md\b|\bregisters?\b|\breceipts?\b|\bmech\b|\bverifier\b|\bwrites?\b/;

// Skills where a signal misleads. One line each: the skill, then why the text above gets it wrong.
export const OVERRIDES = {};

const squash = (text) => text.replace(/\s+/g, ' ');

export function classify(slug, text) {
  if (Object.hasOwn(OVERRIDES, slug)) return { cls: OVERRIDES[slug].cls, why: `override: ${OVERRIDES[slug].why}` };
  const flat = squash(text);
  if (!READ_ONLY.test(flat)) return { cls: 'source', why: 'no read-only declaration' };
  if (EDITS_SOURCE.test(flat) || EDITS_EXISTING.test(flat)) return { cls: 'source', why: 'read-only text plus an editing signal' };
  if (WRITES_ARTIFACT.test(flat)) return { cls: 'artifact', why: 'read-only text plus a write target' };
  return { cls: 'none', why: 'read-only text, no write target' };
}

// The declared `disallowed-tools` value from SKILL.md frontmatter, as a sorted list, or null.
export function declaredTools(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const line = /^disallowed-tools:[ \t]*(.*)$/m.exec(fm[1]);
  if (!line) return null;
  return line[1].split(',').map((t) => t.trim()).filter(Boolean).sort();
}

export function expectedTools(cls) {
  const line = CLASS_LINES[cls];
  return line === null ? null : line.split(', ').sort();
}

export function mismatch(cls, declared) {
  const want = expectedTools(cls);
  return JSON.stringify(want) !== JSON.stringify(declared === null ? null : [...declared].sort());
}

export function listSkills(root = ROOT) {
  const out = [];
  const pluginsDir = join(root, 'plugins');
  for (const plugin of readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const skillsDir = join(pluginsDir, plugin, 'skills');
    if (!existsSync(skillsDir)) continue;
    for (const slug of readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const file = join(skillsDir, slug, 'SKILL.md');
      if (existsSync(file)) out.push({ plugin, slug, file });
    }
  }
  return out;
}

export function run(argv, root = ROOT) {
  const args = argv.slice(2);
  if (args.some((a) => a !== '--check')) { console.error('usage: node scripts/skill-write-class.mjs [--check]'); return 2; }
  const check = args.includes('--check');
  const bad = [];
  const counts = {};
  for (const { plugin, slug, file } of listSkills(root)) {
    const text = readFileSync(file, 'utf8');
    const { cls, why } = classify(slug, text);
    const declared = declaredTools(text);
    const wrong = mismatch(cls, declared);
    counts[plugin] ??= { none: 0, artifact: 0, source: 0 };
    counts[plugin][cls] += 1;
    if (wrong) bad.push(`${plugin}/${slug}: class ${cls} wants ${CLASS_LINES[cls] === null ? 'no disallowed-tools key' : `disallowed-tools: ${CLASS_LINES[cls]}`}, declares ${declared === null ? 'none' : declared.join(', ')}`);
    if (!check) console.log(`${cls.padEnd(8)} ${`${plugin}/${slug}`.padEnd(48)} ${why}`);
  }
  if (!check) for (const [p, c] of Object.entries(counts)) console.log(`${p}: none ${c.none}, artifact ${c.artifact}, source ${c.source}`);
  if (!check) return 0;
  if (bad.length) { for (const b of bad) console.error(`FAIL ${b}`); return 1; }
  console.log(`PASS skill write classes match the declared disallowed-tools (${Object.values(counts).reduce((n, c) => n + c.none + c.artifact + c.source, 0)} skills)`);
  return 0;
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) process.exit(run(process.argv));
