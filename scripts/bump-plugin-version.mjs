#!/usr/bin/env node
// Bump a plugin's version across the three places CLAUDE.md requires it to move together:
// plugin.json, the matching marketplace.json entry, and a new CHANGELOG.md section.
//
//   node scripts/bump-plugin-version.mjs <plugin> <major|minor|patch|X.Y.Z>
//
// Exit 0 = bumped, 1 = failure (bad plugin, malformed/out-of-sync files), 2 = bad invocation
// (wrong arg count, unrecognized bump spec).
//
// Preserves each file's existing formatting: the version value is swapped in place inside
// the raw text (never re-serialized through JSON.stringify), so unrelated whitespace, key
// order, and quoting are untouched. Does NOT touch codex-marketplace/ or run any lint —
// re-run `node scripts/build-codex-marketplace.mjs` (or let the pre-commit hook do it) and
// fill in the CHANGELOG placeholder bullet afterward.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, ''); // tolerate a UTF-8 BOM
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rel = (p) => p.slice(ROOT.length + 1).replaceAll('\\', '/');

const argv = process.argv.slice(2);
if (argv.length !== 2 || argv.some((a) => !a || a.startsWith('--'))) {
  console.error('usage: node scripts/bump-plugin-version.mjs <plugin> <major|minor|patch|X.Y.Z>');
  process.exit(2);
}
const [pluginName, spec] = argv;
if (!/^(major|minor|patch)$/.test(spec) && !/^\d+\.\d+\.\d+$/.test(spec)) {
  console.error(`x unrecognized bump spec "${spec}" — use major, minor, patch, or an explicit X.Y.Z`);
  process.exit(2);
}

const pluginDir = join(ROOT, 'plugins', pluginName);
if (!existsSync(pluginDir)) {
  console.error(`x no such plugin directory: plugins/${pluginName}`);
  process.exit(1);
}

function computeNewVersion(current, bumpSpec) {
  if (/^\d+\.\d+\.\d+$/.test(bumpSpec)) return bumpSpec;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) return null;
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (bumpSpec === 'major') { major += 1; minor = 0; patch = 0; }
  else if (bumpSpec === 'minor') { minor += 1; patch = 0; }
  else { patch += 1; }
  return `${major}.${minor}.${patch}`;
}

function replaceFirstVersionValue(text, expectedOld, replacement) {
  const re = /"version"\s*:\s*"([^"]*)"/;
  const m = re.exec(text);
  if (!m || m[1] !== expectedOld) return null;
  return text.slice(0, m.index) + m[0].replace(expectedOld, replacement) + text.slice(m.index + m[0].length);
}

// ---- plugin.json: swap the version value in place, preserving all other formatting ----
const pluginJsonPath = join(pluginDir, '.claude-plugin', 'plugin.json');
if (!existsSync(pluginJsonPath)) {
  console.error(`x missing ${rel(pluginJsonPath)}`);
  process.exit(1);
}
const pluginJsonText = readText(pluginJsonPath);
let pluginJson;
try {
  pluginJson = JSON.parse(pluginJsonText);
} catch (e) {
  console.error(`x invalid JSON in plugins/${pluginName}/.claude-plugin/plugin.json: ${e.message}`);
  process.exit(1);
}
const oldVersion = pluginJson.version;
if (typeof oldVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(oldVersion)) {
  console.error(`x plugins/${pluginName}/.claude-plugin/plugin.json: version "${oldVersion}" is not a plain X.Y.Z semver — cannot compute a bump`);
  process.exit(1);
}
const newVersion = computeNewVersion(oldVersion, spec);
if (!newVersion) {
  console.error(`x could not compute a new version from "${oldVersion}" + "${spec}"`);
  process.exit(1);
}
if (newVersion === oldVersion) {
  console.error(`x new version "${newVersion}" is identical to the current version — nothing to bump`);
  process.exit(1);
}
const newPluginJsonText = replaceFirstVersionValue(pluginJsonText, oldVersion, newVersion);
if (!newPluginJsonText) {
  console.error(`x could not locate a "version": "${oldVersion}" field to replace in plugins/${pluginName}/.claude-plugin/plugin.json`);
  process.exit(1);
}

// ---- marketplace.json: swap only the version inside THIS plugin's entry ----
const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');
if (!existsSync(marketplacePath)) {
  console.error(`x missing ${rel(marketplacePath)}`);
  process.exit(1);
}
const marketplaceText = readText(marketplacePath);
const nameRe = new RegExp('"name"\\s*:\\s*"' + escapeRe(pluginName) + '"');
const nameMatch = nameRe.exec(marketplaceText);
if (!nameMatch) {
  console.error(`x no "name": "${pluginName}" entry found in .claude-plugin/marketplace.json`);
  process.exit(1);
}
const afterName = marketplaceText.slice(nameMatch.index + nameMatch[0].length);
const nextNameOffset = afterName.search(/"name"\s*:/);
const entryEnd = nameMatch.index + nameMatch[0].length + (nextNameOffset === -1 ? afterName.length : nextNameOffset);
const entrySlice = marketplaceText.slice(nameMatch.index, entryEnd);
const versionRe = /"version"\s*:\s*"([^"]*)"/;
const versionMatch = versionRe.exec(entrySlice);
if (!versionMatch) {
  console.error(`x marketplace.json entry "${pluginName}" has no "version" field`);
  process.exit(1);
}
if (versionMatch[1] !== oldVersion) {
  console.error(`x marketplace.json "${pluginName}" version "${versionMatch[1]}" does not match plugin.json version "${oldVersion}" — reconcile before bumping`);
  process.exit(1);
}
const absVersionStart = nameMatch.index + versionMatch.index;
const newMarketplaceText =
  marketplaceText.slice(0, absVersionStart) +
  versionMatch[0].replace(oldVersion, newVersion) +
  marketplaceText.slice(absVersionStart + versionMatch[0].length);

// ---- CHANGELOG.md: prepend a new version section right after the intro block ----
const changelogPath = join(pluginDir, 'CHANGELOG.md');
if (!existsSync(changelogPath)) {
  console.error(`x missing ${rel(changelogPath)}`);
  process.exit(1);
}
const changelogText = readText(changelogPath);
const firstHeading = changelogText.search(/^##\s+/m);
if (firstHeading === -1) {
  console.error(`x plugins/${pluginName}/CHANGELOG.md has no existing "## <version>" section to anchor the insertion`);
  process.exit(1);
}
const newSection = `## ${newVersion}\n- **TODO** — describe the change.\n\n`;
const newChangelogText = changelogText.slice(0, firstHeading) + newSection + changelogText.slice(firstHeading);

// ---- write all three, only after every computation above has succeeded ----
writeFileSync(pluginJsonPath, newPluginJsonText);
writeFileSync(marketplacePath, newMarketplaceText);
writeFileSync(changelogPath, newChangelogText);

console.log(`${pluginName}: ${oldVersion} -> ${newVersion}`);
console.log(`  ${rel(pluginJsonPath)}`);
console.log(`  ${rel(marketplacePath)}`);
console.log(`  ${rel(changelogPath)}`);
console.log('Fill in the CHANGELOG bullet, then regenerate: node scripts/build-codex-marketplace.mjs');
process.exit(0);
