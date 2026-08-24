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
function inside(base, path) { const rel = relative(base, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); }
const headingCache = new Map();
function headingAnchors(path) {
  if (headingCache.has(path)) return headingCache.get(path);
  const anchors = new Set(); let fenced = false;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/); if (!match) continue;
    const text = match[1]
      .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '');
    const base = text.toLowerCase().trim()
      .replace(/[\p{P}\p{S}]/gu, (character) => character === '-' || character === '_' ? character : '')
      .replace(/\s/g, '-');
    let anchor = base; let suffix = 0;
    while (anchors.has(anchor)) { suffix += 1; anchor = `${base}-${suffix}`; }
    anchors.add(anchor);
  }
  headingCache.set(path, anchors); return anchors;
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
      const destination = match[1].trim().replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']$/, '');
      if (!destination || /^(?:https?:|mailto:|obsidian:)/i.test(destination)) continue;
      const hash = destination.indexOf('#'); let target = (hash < 0 ? destination : destination.slice(0, hash)).split('?', 1)[0];
      let fragment = hash < 0 ? '' : destination.slice(hash + 1).split('?', 1)[0];
      try { target = decodeURIComponent(target); fragment = decodeURIComponent(fragment); } catch { failures.push(`${relative(root, file)}:${index + 1} has invalid URL encoding: ${match[1]}`); continue; }
      if (target.includes('<') || target.includes('>')) continue;
      const absolute = target ? resolve(dirname(file), target) : file;
      const rel = relative(root, absolute);
      if (isAbsolute(target) || rel.startsWith('..') || isAbsolute(rel)) failures.push(`${relative(root, file)}:${index + 1} link escapes repository: ${target}`);
      else if (!existsSync(absolute)) failures.push(`${relative(root, file)}:${index + 1} target does not exist: ${target}`);
      else if (statSync(absolute).isDirectory() && inside(hub, absolute)) failures.push(`${relative(root, file)}:${index + 1} hub-internal target is a directory; link to an index note: ${target}`);
      else if (!exactCase(absolute)) failures.push(`${relative(root, file)}:${index + 1} target case differs from disk: ${target}`);
      else if (fragment && absolute.toLowerCase().endsWith('.md') && !headingAnchors(absolute).has(fragment)) failures.push(`${relative(root, file)}:${index + 1} heading fragment does not exist: ${destination}`);
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
