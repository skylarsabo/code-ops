#!/usr/bin/env node
// Fails closed on broken or portability-unsafe local Markdown links in the documentation hub.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
const args = process.argv.slice(2); const parsed = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]; const value = args[index + 1];
  if (!['--root', '--hub'].includes(key) || parsed[key] || !value || value.startsWith('--')) die('usage: check-doc-links.mjs [--root <repo>] [--hub <dir>]', 2);
  parsed[key] = value;
}
const root = resolve(parsed['--root'] || process.cwd()); const hub = resolve(root, parsed['--hub'] || 'code-ops-docs');
if (!existsSync(hub) || !statSync(hub).isDirectory()) die(`documentation hub is missing: ${hub}`, 2);
const markdown = [];
function walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { if (entry.name.startsWith('.') || entry.name === '80 Runs') continue; const path = resolve(dir, entry.name); if (entry.isDirectory()) walk(path); else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) markdown.push(path); } }
function exactCase(path) {
  const rel = relative(root, path); if (!rel) return resolve(path) === root;
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  let cursor = root;
  for (const part of rel.split(sep)) { if (!existsSync(cursor) || !statSync(cursor).isDirectory() || !readdirSync(cursor).includes(part)) return false; cursor = resolve(cursor, part); }
  return existsSync(cursor);
}
function maskInlineCode(line) {
  let masked = ''; let cursor = 0;
  while (cursor < line.length) {
    const start = line.indexOf('`', cursor);
    if (start < 0) return masked + line.slice(cursor);
    masked += line.slice(cursor, start);
    let endTick = start; while (line[endTick] === '`') endTick += 1;
    const ticks = line.slice(start, endTick); const end = line.indexOf(ticks, endTick);
    if (end < 0) return masked + ' '.repeat(line.length - start);
    masked += ' '.repeat(end + ticks.length - start); cursor = end + ticks.length;
  }
  return masked;
}
function wikiTarget(raw, file, index) {
  const target = raw.split('|', 1)[0].trim(); const note = target.split('#', 1)[0].trim();
  if (!note) return file;
  const normalized = note.toLowerCase().endsWith('.md') ? note : `${note}.md`;
  if (normalized.includes('/') || normalized.includes('\\')) return resolve(hub, normalized);
  const base = normalized.slice(0, -3); const matches = markdown.filter((candidate) => candidate.slice(0, -3).split(sep).join('/').endsWith(`/${base}`));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) failures.push(`${relative(root, file)}:${index + 1} wikilink target does not exist: ${raw}`);
  else failures.push(`${relative(root, file)}:${index + 1} wikilink target is ambiguous: ${raw}`);
  return null;
}
walk(hub); const failures = [];
for (const file of markdown.sort()) {
  let fenced = false;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced || /^(?: {4}|\t)/.test(line)) return;
    const scanned = maskInlineCode(line);
    for (const match of scanned.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']$/, '');
      if (!target || target.startsWith('#') || /^(?:https?:|mailto:|obsidian:)/i.test(target)) continue;
      target = target.split('#', 1)[0].split('?', 1)[0];
      try { target = decodeURIComponent(target); } catch { failures.push(`${relative(root, file)}:${index + 1} has invalid URL encoding: ${match[1]}`); continue; }
      if (!target || target.includes('<') || target.includes('>')) continue;
      const absolute = resolve(dirname(file), target);
      const rel = relative(root, absolute);
      if (isAbsolute(target) || rel.startsWith('..') || isAbsolute(rel)) failures.push(`${relative(root, file)}:${index + 1} link escapes repository: ${target}`);
      else if (!existsSync(absolute)) failures.push(`${relative(root, file)}:${index + 1} target does not exist: ${target}`);
      else if (!exactCase(absolute)) failures.push(`${relative(root, file)}:${index + 1} target case differs from disk: ${target}`);
    }
    for (const match of scanned.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const absolute = wikiTarget(match[1], file, index); if (!absolute) continue;
      const rel = relative(root, absolute);
      if (rel.startsWith('..') || isAbsolute(rel)) failures.push(`${relative(root, file)}:${index + 1} wikilink escapes repository: ${match[1]}`);
      else if (!existsSync(absolute)) failures.push(`${relative(root, file)}:${index + 1} wikilink target does not exist: ${match[1]}`);
      else if (!exactCase(absolute)) failures.push(`${relative(root, file)}:${index + 1} wikilink target case differs from disk: ${match[1]}`);
    }
  });
}
if (failures.length) die(`${failures.length} broken documentation link(s):\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
console.log(`ok documentation links (${markdown.length} Markdown files)`);
