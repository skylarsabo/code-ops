#!/usr/bin/env node
// Fail-closed line- and commit-citation gate for current Markdown manifest targets.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideCodeSpan } from './record-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_SUFFIX = '/98 System/DOCS_MANIFEST.json';
// The first path segment and filename stay space-free. Only interior directory segments
// may contain spaces (for example `code-ops-docs/40 Engineering/Techniques/file.md`).
// Keeping the first segment space-free prevents ordinary prose such as "See scripts/..."
// from being swallowed into the citation path. `[` is a valid left delimiter so bracketed
// citations receive the same validation as backticked and bare citations.
const CITE_RE = /(?:^|[\s\[(`"'])((?:[A-Za-z0-9_.-]+\/)(?:(?:[A-Za-z0-9_.-]+(?: [A-Za-z0-9_.-]+)*)\/)*[A-Za-z0-9_.-]+\.(?:mjs|js|md|yml|yaml|json)):([0-9]+)(?:-([0-9]+))?(?=$|[\s`)\]"'.,;:])/g;
const COMMIT_FIELDS = [
  ['Verified-at', /\bVerified-at\s*:\s*(.*)$/g],
  ['OBSOLETE-AT', /\bOBSOLETE-AT\s*:\s*(.*)$/g],
  ['implementation-evidence commit', /\bImplementation evidence\s*:\s*commit\s*(.*)$/g],
];
function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT, timeout: 10000, maxBuffer: 64 * 1024 * 1024, ...options,
  }).toString().trim();
}
function gitPaths(args) {
  return execFileSync('git', args, { cwd: ROOT, timeout: 10000, maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\0').filter(Boolean);
}
function loadManifest(files) {
  const candidates = files.filter((file) => file.endsWith(MANIFEST_SUFFIX));
  if (candidates.length !== 1) die(candidates.length ? `multiple documentation manifests found: ${candidates.join(', ')}` : 'no documentation manifest found at <hub>/98 System/DOCS_MANIFEST.json', 2);
  let manifest;
  try { manifest = JSON.parse(readFileSync(resolve(ROOT, candidates[0]), 'utf8')); }
  catch (error) { die(`cannot parse documentation manifest: ${error.message}`, 2); }
  const hub = candidates[0].slice(0, -MANIFEST_SUFFIX.length);
  if (!manifest || ![1, 2].includes(manifest.version) || manifest.hub !== hub || !Array.isArray(manifest.domains)) die('documentation manifest has invalid version, hub, or domains', 2);
  return { manifest, hub };
}
function isTarget(path, target) { return path === target || path.startsWith(`${target}/`); }
function lineCount(absPath) {
  let text;
  try { text = readFileSync(absPath, 'utf8'); } catch { return -1; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.length === 0) return 0;
  const nl = (text.match(/\n/g) || []).length;
  return text.endsWith('\n') ? nl : nl + 1;
}
function checkCitation(citPath, startLn, endLn) {
  if (startLn < 1) return 'line 0 is not a valid line number';
  if (endLn < startLn) return `range end ${endLn} is before start ${startLn}`;
  const abs = resolve(ROOT, citPath);
  if (!(abs === ROOT || abs.startsWith(ROOT + sep))) return 'path escapes the repo root';
  if (!existsSync(abs)) return 'target file does not exist';
  let stat;
  try { stat = statSync(abs); } catch { return 'target file does not exist'; }
  if (!stat.isFile()) return 'target path is not a file';
  const total = lineCount(abs);
  if (total < 0) return 'target file is unreadable';
  const over = Math.max(startLn, endLn);
  return over > total ? `line ${over} exceeds target's ${total} line(s)` : null;
}
function objectIdLength() {
  let format;
  try { format = git(['rev-parse', '--show-object-format']); }
  catch { die('cannot determine repository object format', 2); }
  const lengths = { sha1: 40, sha256: 64 };
  if (!(format in lengths)) die(`unsupported repository object format: ${format}`, 2);
  return lengths[format];
}
function checkCommitCitation(value, oidLength, shallow) {
  if (!/^[0-9a-f]+$/i.test(value)) return 'commit identifier must be hexadecimal';
  if (value.length < 7) return 'commit identifier must be at least 7 hexadecimal characters';
  if (value.length > oidLength) return `commit identifier exceeds this repository's ${oidLength}-character object ID length`;
  let resolved;
  try { resolved = git(['rev-parse', '--verify', '--quiet', `${value}^{commit}`]); }
  catch { return shallow ? 'infrastructure failure: shallow repository lacks required commit history' : 'commit identifier does not resolve to a commit'; }
  if (!resolved || !resolved.startsWith(value.toLowerCase())) return 'commit identifier is ambiguous';
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', resolved, 'HEAD'], {
      cwd: ROOT, timeout: 10000, stdio: 'ignore',
    });
  }
  catch { return 'commit is not a durable ancestor of HEAD'; }
  return null;
}
function allowedCommitFieldTail(tail, kind) {
  if (/^[*),.;:\]}]*$/.test(tail)) return true;
  if (/^\s*\(\d{4}-\d{2}-\d{2}\)[*),.;:\]}]*$/.test(tail)) return true;
  return kind === 'implementation-evidence commit' && /^,\s/.test(tail);
}
function commitFields(line) {
  const fields = [];
  for (const [kind, pattern] of COMMIT_FIELDS) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      if (isInsideCodeSpan(line, match.index)) continue;
      const raw = match[1].trim();
      if (!raw) {
        fields.push({ kind, value: '', malformed: 'commit identifier is missing' });
        continue;
      }
      if (raw.startsWith('`')) {
        const close = raw.indexOf('`', 1);
        if (close < 0) {
          fields.push({ kind, value: '', malformed: 'commit identifier has an unclosed backtick delimiter' });
          continue;
        }
        const tail = raw.slice(close + 1);
        fields.push({ kind, value: raw.slice(1, close), malformed: allowedCommitFieldTail(tail, kind) ? null : 'commit field has trailing content' });
        continue;
      }
      const token = /^([^\s*),.;:\]}]+)(.*)$/.exec(raw);
      if (!token) {
        fields.push({ kind, value: '', malformed: 'commit identifier is missing' });
        continue;
      }
      fields.push({ kind, value: token[1], malformed: allowedCommitFieldTail(token[2], kind) ? null : 'commit field has trailing content' });
    }
  }
  return fields;
}

const argv = process.argv.slice(2);
if (argv.length) die(argv[0].trim() === '' ? 'blank flag' : `unknown flag: ${argv[0]}`, 2);
let tracked;
try { tracked = gitPaths(['ls-files', '-co', '--exclude-standard', '-z']); }
catch { die('not a git work tree (check-doc-citations requires git ls-files)', 2); }
const { manifest, hub } = loadManifest(tracked);
const targets = manifest.domains.filter((domain) => ['current', 'not-applicable'].includes(domain.status) && typeof domain.path === 'string' && domain.path.length)
  .map((domain) => `${hub}/${domain.path}`);
if (!targets.length) die('documentation manifest has no owned domains to scan', 2);
const docs = tracked.filter((file) => file.toLowerCase().endsWith('.md') && targets.some((target) => isTarget(file, target))).sort();
const oidLength = objectIdLength();
const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
const violations = [];
let infrastructureFailure = false;
for (const rel of docs) {
  let text;
  try { text = readFileSync(resolve(ROOT, rel), 'utf8'); } catch { continue; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  let fence = null;
  for (const [index, line] of text.split('\n').entries()) {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    const closing = fence && /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
    if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
      fence = null;
      continue;
    }
    if (fence) continue;
    for (const match of line.matchAll(CITE_RE)) {
      const start = Number(match[2]); const end = match[3] === undefined ? start : Number(match[3]);
      const reason = checkCitation(match[1], start, end);
      if (reason) violations.push(`${rel}:${index + 1} cites ${match[1]}:${match[2]}${match[3] === undefined ? '' : `-${match[3]}`} — ${reason}`);
    }
    for (const field of commitFields(line)) {
      const reason = field.malformed || checkCommitCitation(field.value, oidLength, shallow);
      if (reason) {
        if (reason.startsWith('infrastructure failure:')) infrastructureFailure = true;
        violations.push(`${rel}:${index + 1} ${field.kind} commit \`${field.value || '<missing>'}\` — ${reason}`);
      }
    }
  }
}
if (violations.length) {
  for (const violation of violations) console.error(`x ${violation}`);
  console.error(`\n${violations.length} violation(s) across ${docs.length} manifest-owned doc(s) scanned.`);
  process.exit(infrastructureFailure ? 2 : 1);
}
console.log(`OK — ${docs.length} manifest-owned doc(s) scanned; every path:line and commit citation resolves.`);
