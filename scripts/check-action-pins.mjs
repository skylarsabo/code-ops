#!/usr/bin/env node
// Verify that governed GitHub workflows use reviewed immutable actions and one Node SSOT.
//
//   node scripts/check-action-pins.mjs [--root <repo-root>]

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^v\d+\.\d+\.\d+$/;
const OWNER_REPO_PATH = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*$/;
const ANCHOR = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const DIRECT_USES = /^(\s*)(-\s+)?(?:uses|'uses'|"uses")\s*:\s*(.*?)\s*$/;
const DIRECT_NODE_VERSION_FILE = /^\s*(?:node-version-file|'node-version-file'|"node-version-file")\s*:\s*(.*?)\s*$/;
const USES_KEY = /(?:^|[\s{,[])(?:uses|'uses'|"uses")\s*:/;
const NODE_VERSION_KEY = /(?:^|[\s{,[])(?:node-version|'node-version'|"node-version")\s*:/;
const NODE_VERSION_FILE_KEY = /(?:^|[\s{,[])(?:node-version-file|'node-version-file'|"node-version-file")\s*:/;

const usage = () => {
  console.error('usage: node scripts/check-action-pins.mjs [--root <repo-root>]');
  process.exit(2);
};

const args = process.argv.slice(2);
let root = ROOT;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--root' || !args[1]) usage();
  root = resolve(args[1]);
}

const failures = [];
const fail = (message) => failures.push(message);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (base, target) => {
  const path = relative(base, target);
  return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !path.includes('\0'));
};
const safeIdentity = (identity) => OWNER_REPO_PATH.test(identity)
  && identity === identity.toLowerCase()
  && identity.split('/').every((part) => part !== '.' && part !== '..');
const indentOf = (line) => line.match(/^ */)[0].length;

const hasSymlinkComponent = (base, target) => {
  const path = relative(base, target);
  if (!inside(base, target)) return true;
  let cursor = base;
  for (const part of path.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
};

const splitComment = (text) => {
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index++;
      else if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') index++;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return { code: text.slice(0, index).trimEnd(), comment: text.slice(index + 1).trim() };
    }
  }
  return { code: text.trimEnd(), comment: null };
};

const scalar = (text) => {
  const value = text.trim();
  if (!value) return null;
  if (value[0] === "'") {
    if (value.at(-1) !== "'") return null;
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value[0] === '"') {
    if (value.at(-1) !== '"') return null;
    try { return JSON.parse(value); } catch { return null; }
  }
  if (/[\s'"\[\]{},]/.test(value)) return null;
  return value;
};

const maskBlockScalars = (lines) => {
  const visible = [];
  let blockIndent = null;
  for (const line of lines) {
    const indent = indentOf(line);
    if (blockIndent !== null) {
      if (!line.trim() || indent > blockIndent) {
        visible.push('');
        continue;
      }
      blockIndent = null;
    }
    visible.push(line);
    const { code } = splitComment(line);
    if (/^\s*(?:-\s+)?[^:]+:\s*[>|][0-9+-]*\s*$/.test(code)) blockIndent = indent;
  }
  return visible;
};

const policyPath = resolve(root, '.github', 'actions-lock.json');
if (!existsSync(policyPath)) {
  console.error(`FAIL - action pin policy is missing: ${policyPath}`);
  process.exit(1);
}

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, 'utf8'));
} catch (error) {
  console.error(`FAIL - could not parse ${policyPath}: ${error.message}`);
  process.exit(1);
}

if (!plainObject(policy)) fail('policy must be a JSON object');
if (plainObject(policy)) {
  for (const key of ['schemaVersion', 'reviewedAt', 'nodeVersionFile', 'sources', 'actions', 'allowLocalActions']) {
    if (!(key in policy)) fail(`policy is missing required key "${key}"`);
  }
  if (policy.schemaVersion !== 1) fail('policy schemaVersion must equal 1');
  const reviewedDate = typeof policy.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(policy.reviewedAt)
    ? new Date(`${policy.reviewedAt}T00:00:00Z`) : null;
  if (!reviewedDate || Number.isNaN(reviewedDate.valueOf()) || reviewedDate.toISOString().slice(0, 10) !== policy.reviewedAt) {
    fail('policy reviewedAt must be a valid YYYY-MM-DD date');
  }
  if (typeof policy.nodeVersionFile !== 'string' || !policy.nodeVersionFile || policy.nodeVersionFile.includes('\0')) {
    fail('policy nodeVersionFile must be a non-empty repository-relative path');
  }
  if (!Array.isArray(policy.sources) || policy.sources.length === 0) fail('policy sources must be a non-empty array');
  if (!plainObject(policy.actions)) fail('policy actions must be an object');
  if (typeof policy.allowLocalActions !== 'boolean') fail('policy allowLocalActions must be a boolean');
}

let nodeVersionFile = null;
if (typeof policy?.nodeVersionFile === 'string' && policy.nodeVersionFile) {
  nodeVersionFile = resolve(root, policy.nodeVersionFile);
  if (!inside(root, nodeVersionFile)) fail(`policy nodeVersionFile escapes repository root: ${policy.nodeVersionFile}`);
  else if (!existsSync(nodeVersionFile)) fail(`policy nodeVersionFile is missing: ${policy.nodeVersionFile}`);
  else if (hasSymlinkComponent(root, nodeVersionFile) || !lstatSync(nodeVersionFile).isFile()) {
    fail(`policy nodeVersionFile must be a physical regular file: ${policy.nodeVersionFile}`);
  } else {
    const version = readFileSync(nodeVersionFile, 'utf8').trim();
    if (!/^\d+(?:\.\d+){0,2}$/.test(version)) fail('policy nodeVersionFile must contain one numeric Node version');
  }
}

const sourcePaths = [];
if (Array.isArray(policy?.sources)) {
  const seen = new Set();
  for (const source of policy.sources) {
    if (typeof source !== 'string' || !source || source.includes('\0')) {
      fail('each policy source must be a non-empty string');
      continue;
    }
    const path = resolve(root, source);
    if (!inside(root, path)) {
      fail(`policy source escapes repository root: ${source}`);
      continue;
    }
    if (!existsSync(path)) {
      fail(`declared source is missing: ${source}`);
      continue;
    }
    if (hasSymlinkComponent(root, path)) {
      fail(`declared source must not traverse a symbolic link: ${source}`);
      continue;
    }
    const physical = realpathSync.native(path);
    const physicalRoot = realpathSync.native(root);
    if (!inside(physicalRoot, physical)) {
      fail(`declared source escapes physical repository root: ${source}`);
      continue;
    }
    if (seen.has(physical)) {
      fail(`policy source is duplicated: ${source}`);
      continue;
    }
    seen.add(physical);
    sourcePaths.push(path);
  }
}

const actions = new Map();
if (plainObject(policy?.actions)) {
  for (const [identity, pin] of Object.entries(policy.actions)) {
    if (!safeIdentity(identity)) {
      fail(`policy action identity is invalid or non-canonical: ${identity}`);
      continue;
    }
    if (!plainObject(pin)) {
      fail(`policy action ${identity} must be an object`);
      continue;
    }
    for (const key of ['sha', 'version', 'repository', 'license', 'tagVerification', 'runtime', 'workflowPermissions', 'egress', 'telemetry', 'advisories']) {
      if (!(key in pin)) fail(`policy action ${identity} is missing review metadata "${key}"`);
    }
    if (typeof pin.sha !== 'string' || !SHA.test(pin.sha)) fail(`policy action ${identity} sha must be 40 lowercase hexadecimal characters`);
    if (typeof pin.version !== 'string' || !VERSION.test(pin.version)) fail(`policy action ${identity} version must be a full v-prefixed semantic version`);
    const [owner, repo] = identity.split('/');
    if (pin.repository !== `https://github.com/${owner}/${repo}`) fail(`policy action ${identity} repository must name its GitHub source`);
    for (const key of ['license', 'tagVerification', 'runtime', 'egress', 'telemetry']) {
      if (typeof pin[key] !== 'string' || !pin[key].trim()) fail(`policy action ${identity} ${key} must be a non-empty string`);
    }
    if (!Array.isArray(pin.workflowPermissions) || pin.workflowPermissions.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      fail(`policy action ${identity} workflowPermissions must be an array of non-empty strings`);
    }
    if (!Array.isArray(pin.advisories) || pin.advisories.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      fail(`policy action ${identity} advisories must be an array of non-empty strings`);
    }
    if (typeof pin.sha === 'string' && SHA.test(pin.sha) && typeof pin.version === 'string' && VERSION.test(pin.version)) actions.set(identity, pin);
  }
}

const yamlFiles = [];
const yamlSeen = new Set();
const collectYaml = (path) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    fail(`declared source contains a symbolic link: ${relative(root, path)}`);
    return;
  }
  if (stat.isFile()) {
    if (!['.yml', '.yaml'].includes(extname(path).toLowerCase())) {
      fail(`declared source file is not YAML: ${relative(root, path)}`);
      return;
    }
    const physical = realpathSync.native(path);
    if (!yamlSeen.has(physical)) {
      yamlSeen.add(physical);
      yamlFiles.push(path);
    }
    return;
  }
  if (!stat.isDirectory()) {
    fail(`declared source is neither a file nor directory: ${relative(root, path)}`);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    collectYaml(resolve(path, entry.name));
  }
};
for (const source of sourcePaths) collectYaml(source);

const validateLocal = (target, rel, line) => {
  if (!policy?.allowLocalActions) {
    fail(`${rel}:${line}: local action is forbidden by policy`);
    return false;
  }
  if (!/^\.\/[A-Za-z0-9._/-]+$/.test(target) || target.split('/').includes('..') || target.includes('\\')) {
    fail(`${rel}:${line}: local action path is unsafe: ${target}`);
    return false;
  }
  const path = resolve(root, target.slice(2));
  if (!inside(root, path) || !existsSync(path) || hasSymlinkComponent(root, path)) {
    fail(`${rel}:${line}: local action path is missing or non-physical: ${target}`);
    return false;
  }
  const stat = lstatSync(path);
  if (stat.isFile()) {
    if (!/\.ya?ml$/i.test(path)) {
      fail(`${rel}:${line}: local reusable workflow must be YAML: ${target}`);
      return false;
    }
    collectYaml(path);
  } else {
    const definitions = ['action.yml', 'action.yaml']
      .map((name) => resolve(path, name))
      .filter((candidate) => existsSync(candidate));
    if (!stat.isDirectory() || definitions.length === 0) {
      fail(`${rel}:${line}: local action directory has no action.yml or action.yaml: ${target}`);
      return false;
    }
    // A local action is trusted only as a path boundary. Its own dependencies remain
    // governed, so enqueue every present metadata spelling for the same fail-closed scan.
    for (const definition of definitions) collectYaml(definition);
  }
  return true;
};

const parseUse = (value, annotation) => {
  const anchored = /^&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+)$/.exec(value.trim());
  const anchor = anchored?.[1] || null;
  const target = scalar(anchored?.[2] ?? value);
  return target ? { anchor, target, annotation } : null;
};

const stepBounds = (lines, index, usesIndent, hasDash) => {
  let base = hasDash ? usesIndent : null;
  if (base === null) {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (!lines[cursor].trim()) continue;
      const match = /^(\s*)-(?:\s+|$)/.exec(lines[cursor]);
      if (match && match[1].length < usesIndent) { base = match[1].length; break; }
      if (indentOf(lines[cursor]) < usesIndent) break;
    }
  }
  if (base === null) return null;
  let end = lines.length;
  for (let cursor = index + 1; cursor < lines.length; cursor++) {
    if (!lines[cursor].trim()) continue;
    if (new RegExp(`^ {${base}}-(?:\\s+|$)`).test(lines[cursor])) { end = cursor; break; }
    if (indentOf(lines[cursor]) < base) { end = cursor; break; }
  }
  return { start: index + 1, end };
};

for (const file of yamlFiles) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const first = raw.trimStart()[0];
  if (first === '{' || first === '[') {
    fail(`${rel}: JSON or top-level flow workflow syntax is unsupported by the action-pin policy`);
    continue;
  }
  const lines = maskBlockScalars(raw.split(/\r?\n/));
  const anchors = new Map();
  const resolvedUses = [];

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const { code, comment } = splitComment(lines[index]);
    if (!code.trim()) continue;
    if (/^\s*\?\s/.test(code) || /(?:^|[\s{,[])\*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(code)) {
      fail(`${rel}:${line}: complex or aliased mapping keys are unsupported`);
      continue;
    }
    for (const match of code.matchAll(/"(?:[^"\\]|\\.)*"\s*:/g)) {
      if (match[0].includes('\\')) fail(`${rel}:${line}: escaped quoted mapping keys are unsupported`);
    }
    if (NODE_VERSION_KEY.test(code)) fail(`${rel}:${line}: hard-coded node-version duplicates the policy nodeVersionFile`);
    if (NODE_VERSION_FILE_KEY.test(code)) {
      const direct = DIRECT_NODE_VERSION_FILE.exec(code);
      const value = direct ? scalar(direct[1]) : null;
      if (!direct || value !== policy?.nodeVersionFile) fail(`${rel}:${line}: node-version-file must equal ${policy?.nodeVersionFile ?? '<policy path>'}`);
    }

    const uses = DIRECT_USES.exec(code);
    if (!uses) {
      if (USES_KEY.test(code)) fail(`${rel}:${line}: flow or otherwise non-canonical uses syntax is unsupported`);
      const anchor = /:\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?)\s*$/.exec(code);
      if (anchor) {
        const target = scalar(anchor[2]);
        if (target) anchors.set(anchor[1], { target, annotation: comment });
      }
      continue;
    }

    let parsed = parseUse(uses[3], comment);
    if (!parsed) {
      fail(`${rel}:${line}: malformed uses declaration`);
      continue;
    }
    if (parsed.target.startsWith('*')) {
      const name = parsed.target.slice(1);
      if (parsed.anchor || parsed.annotation !== null || !ANCHOR.test(name) || !anchors.has(name)) {
        fail(`${rel}:${line}: unresolved or malformed uses alias: ${parsed.target}`);
        continue;
      }
      parsed = { ...anchors.get(name), anchor: null };
    }

    let valid = true;
    let identity = null;
    if (parsed.target.startsWith('./')) valid = validateLocal(parsed.target, rel, line);
    else {
      const action = /^([^@\s]+)@([^@\s]+)$/.exec(parsed.target);
      if (!action || !safeIdentity(action[1])) {
        fail(`${rel}:${line}: external uses must name a canonical owner/repo[/path]@immutable-sha`);
        valid = false;
      } else {
        [, identity] = action;
        const sha = action[2];
        const pin = actions.get(identity);
        if (!pin) {
          fail(`${rel}:${line}: action is not allowlisted: ${identity}`);
          valid = false;
        }
        if (!SHA.test(sha)) {
          fail(`${rel}:${line}: action reference is mutable: ${parsed.target}`);
          valid = false;
        } else if (pin && sha !== pin.sha) {
          fail(`${rel}:${line}: action SHA does not match policy for ${identity}`);
          valid = false;
        }
        if (!pin || parsed.annotation !== pin.version) {
          fail(`${rel}:${line}: version annotation must equal # ${pin?.version ?? '<policy version>'}`);
          valid = false;
        }
      }
    }
    if (parsed.anchor) {
      if (anchors.has(parsed.anchor)) {
        fail(`${rel}:${line}: duplicate scalar anchor: ${parsed.anchor}`);
        valid = false;
      } else if (valid) anchors.set(parsed.anchor, { target: parsed.target, annotation: parsed.annotation });
    }
    if (valid) resolvedUses.push({ index, line, identity, indent: uses[1].length, hasDash: Boolean(uses[2]) });
  }

  for (const use of resolvedUses.filter((entry) => entry.identity === 'actions/setup-node')) {
    const bounds = stepBounds(lines, use.index, use.indent, use.hasDash);
    if (!bounds) {
      fail(`${rel}:${use.line}: setup-node must appear in a canonical YAML step`);
      continue;
    }
    let count = 0;
    for (let index = bounds.start; index < bounds.end; index++) {
      const { code } = splitComment(lines[index]);
      const match = DIRECT_NODE_VERSION_FILE.exec(code);
      if (match && scalar(match[1]) === policy?.nodeVersionFile) count++;
    }
    if (count !== 1) fail(`${rel}:${use.line}: setup-node step must contain exactly one node-version-file: ${policy?.nodeVersionFile}`);
  }
}

if (failures.length) {
  console.error('FAIL - action pins:');
  for (const failure of failures) console.error('  x ' + failure);
  process.exit(1);
}

console.log(`OK - ${yamlFiles.length} YAML file(s) scanned with ${actions.size} allowlisted action pin(s).`);
