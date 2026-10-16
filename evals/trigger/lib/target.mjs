// A fresh per-session copy of the code a query is asked about. Answer-key material never enters it.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Excluded from the copy. PROVENANCE.md names the seeding policy and the paths seeds avoid, so it
// is a hint at planted changes. LICENSE stays: the vendored upstream code is MIT.
const EXCLUDED_FILES = new Set(['PROVENANCE.md']);
const isAnswerKey = (name) => name.toUpperCase().startsWith('ANSWER_KEY');

/** POSIX relative paths of every file under dir, without answer keys, provenance, or node_modules. */
function listCopyable(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.name === 'node_modules' || isAnswerKey(ent.name) || (!rel && EXCLUDED_FILES.has(ent.name))) continue;
      if (ent.isDirectory()) walk(join(abs, ent.name), r);
      else if (ent.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

/** Every path under dir (files and folders) whose name starts with ANSWER_KEY, case-insensitively. */
export function findAnswerKeys(dir) {
  const hits = [];
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (isAnswerKey(ent.name)) hits.push(r);
      else if (ent.isDirectory()) walk(join(abs, ent.name), r);
    }
  };
  walk(dir, '');
  return hits;
}

/** Throws if any ANSWER_KEY path is under dir. The fail-closed check before a session spawns. */
export function assertNoAnswerKeys(dir) {
  const keys = findAnswerKeys(dir);
  if (keys.length) throw new Error(`answer-key paths reached the session copy: ${keys.join(', ')}`);
}

/**
 * Copy source into a new temp folder and return its path. Throws before returning, and removes the
 * copy, if any ANSWER_KEY path is in it. The caller removes the copy with rmSync.
 */
export function makeSessionCopy(source) {
  const dir = mkdtempSync(join(tmpdir(), 'trigger-'));
  try {
    for (const r of listCopyable(source)) {
      const to = join(dir, ...r.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(source, ...r.split('/')), to);
    }
    assertNoAnswerKeys(dir);
    return dir;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Run fn(copyPath) inside a fresh copy of source and remove the copy afterwards, whether fn
 * resolves or throws. A killed session can hold its folder for a while on win32, so removal retries,
 * and a folder that still cannot be removed is reported and left behind instead of ending the run.
 * The copy holds only target code, so a leftover folder leaks nothing.
 */
export async function withSessionCopy(source, fn, remove = rmSync) {
  const dir = makeSessionCopy(source);
  try {
    return await fn(dir);
  } finally {
    try {
      remove(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (e) {
      console.warn(`trigger: left session copy ${dir}: ${e.code ?? e.message}`);
    }
  }
}
