// Void audit for one benchmark unit (design: "Answer-key isolation"). Pure over strings.
//
//   auditUnit({ transcriptTexts, findingsText, repoRoot, runFolder, canary, upstream, allowedPaths,
//               protectedPaths, home }) -> { void, triggers: [{ rule, where, excerpt }] }
//
// Rules: repo-path (the repository root or the run folder inside a tool input), answer-key (the
// string ANSWER_KEY in any case, or the canary, anywhere), upstream-fetch (an upstream URL in any
// tool input, the upstream name inside a network command, or the name in the input of a web tool).
// Paths compare case-insensitively with every run of slashes and backslashes folded to one slash,
// in drive form (c:/x), MSYS form (/c/x), and, for a path under the home directory, the home forms
// (~/x, $HOME/x, ${HOME}/x, %USERPROFILE%/x, $env:USERPROFILE/x). A tool input that names
// evals/bench/targets triggers repo-path too: a relative path cannot be resolved here, and the
// sandbox never holds that directory. A path under an allowed path never triggers repo-path,
// except a protected path (the bench key files), which always does. An excerpt holds at most 120
// characters and never the canary.

import { homedir } from 'node:os';

const NETWORK = new RegExp(
  '\\b(?:curl|wget|npx|bunx|pnpx|invoke-webrequest|iwr|invoke-restmethod|irm'
  + '|git\\b[^;&|\\n]*?\\s(?:clone|fetch|pull|ls-remote|submodule)'
  + '|(?:npm|pnpm|yarn|bun)\\b[^;&|\\n]*?\\s(?:install|i|add|view|show|info|pack|fetch)'
  + '|gh\\s+(?:api|repo\\s+clone|release\\s+download)'
  + '|(?:node|deno)\\b[^;&|\\n]*?\\b(?:fetch|https?)'
  + '|python[\\d.]*\\b[^;&|\\n]*?\\b(?:requests|urllib))\\b', 'i');
const HOME_ROOTS = ['~', '$home', '${home}', '%userprofile%', '$env:userprofile'];
const RELATIVE_TARGETS = 'evals/bench/targets';
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const EXCERPT = 120;

const fold = (s) => s.toLowerCase().replace(/[\\/]+/g, '/');
/** The folded forms one path can take in a tool input. */
function pathForms(p, home) {
  const f = fold(p).replace(/\/+$/, '');
  const drive = f.match(/^([a-z]):(\/.*)?$/);
  const forms = drive ? [f, `/${drive[1]}${drive[2] ?? ''}`] : [f];
  const h = home ? fold(home).replace(/\/+$/, '') : '';
  if (h && f.startsWith(`${h}/`)) for (const r of HOME_ROOTS) forms.push(r + f.slice(h.length));
  return forms;
}
/** Index ranges where `form` occurs in `text` and ends at a path boundary. */
function spans(text, form) {
  const out = [];
  for (let i = text.indexOf(form); i !== -1; i = text.indexOf(form, i + 1)) {
    const next = text[i + form.length];
    if (next === undefined || !/[\w.-]/.test(next)) out.push([i, i + form.length]);
  }
  return out;
}

/** The commands of a shell line: split at ; & | and newline, except inside quotes. */
function commands(line) {
  const out = [];
  let cur = '';
  let quote = '';
  for (const c of line) {
    if (quote) { if (c === quote) quote = ''; cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (';&|\n'.includes(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Every string leaf of a JSON value. */
function leaves(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
}

/** The tool inputs in one transcript: [{ name, texts }]. A line that is not JSON counts whole. */
function toolInputs(transcript) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (v.type === 'tool_use') found.push({ name: String(v.name ?? ''), texts: leaves(v.input) });
    else Object.values(v).forEach(walk);
  };
  for (const line of transcript.split('\n')) {
    if (line.trim() === '') continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { found.push({ name: '', texts: [line] }); continue; }
    walk(parsed);
  }
  return found;
}

export function auditUnit({ transcriptTexts = [], findingsText = '', repoRoot, runFolder, canary, upstream, allowedPaths = [], protectedPaths = [], home = homedir() }) {
  const triggers = [];
  const mask = (s) => (/^[0-9a-f]+$/i.test(canary ?? '') ? s.replace(new RegExp(canary, 'gi'), '<canary>') : s);
  // text must already be masked, so an index never points past a canary.
  const add = (rule, where, text, index) => {
    const from = Math.max(0, index - 40);
    triggers.push({ rule, where, excerpt: text.slice(from, from + EXCERPT).replace(/\s+/g, ' ') });
  };

  const names = [...new Set([].concat(upstream ?? []).flatMap((u) => [u, String(u).replace(/\/+$/, '').split('/').pop()])
    .map((n) => String(n).toLowerCase()).filter((n) => n !== ''))];
  const forms = (p) => pathForms(p, home);
  // An allowed path covers a root form but never a protected path.
  const rootForms = [repoRoot, runFolder].filter(Boolean).map(forms);
  const protectedForms = protectedPaths.filter(Boolean).map(forms);
  const allowed = allowedPaths.flatMap(forms);
  // An upstream URL as given, without its scheme, and as an ssh remote (host:path).
  const urls = [...new Set(names.filter((n) => n.includes('://')).flatMap((u) => {
    const full = u.replace(/\/+$/, '').replace(/\.git$/, '');
    const bare = full.replace(/^[a-z+]+:\/\//, '');
    return [full, bare, bare.replace('/', ':')];
  }))];

  const texts = [...transcriptTexts.map((t, i) => [`transcript[${i}]`, t]), ['findings', findingsText]];
  for (const [where, raw] of texts) {
    const text = mask(raw ?? '');
    const key = [text.toLowerCase().indexOf('answer_key'), text.indexOf('<canary>')].filter((i) => i !== -1).sort((x, y) => x - y)[0];
    if (key !== undefined) add('answer-key', where, text, key);
  }

  transcriptTexts.forEach((transcript, t) => {
    for (const { name, texts: inputs } of toolInputs(mask(transcript))) {
      const where = `transcript[${t}]`;
      for (const leaf of inputs) {
        const f = fold(leaf).replace(/["']/g, '');
        const covered = allowed.flatMap((a) => spans(f, a));
        let hit = f.indexOf(RELATIVE_TARGETS);
        const earliest = (s) => { if (hit === -1 || s < hit) hit = s; };
        for (const group of rootForms) {
          for (const form of group) {
            for (const [s, e] of spans(f, form)) if (!covered.some(([cs, ce]) => cs <= s && ce >= e)) earliest(s);
          }
        }
        for (const group of protectedForms) for (const form of group) for (const [s] of spans(f, form)) earliest(s);
        if (hit !== -1) add('repo-path', where, f, hit);
        const lowLeaf = leaf.toLowerCase();
        const urlAt = urls.map((u) => lowLeaf.indexOf(u)).filter((i) => i !== -1);
        if (urlAt.length > 0) { add('upstream-fetch', where, lowLeaf, Math.min(...urlAt)); continue; }
        const segments = WEB_TOOLS.has(name) ? [lowLeaf] : commands(lowLeaf).filter((s) => NETWORK.test(s));
        const seg = segments.find((s) => names.some((n) => s.includes(n)));
        if (seg !== undefined) add('upstream-fetch', where, seg, Math.min(...names.map((n) => seg.indexOf(n)).filter((i) => i !== -1)));
      }
    }
  });
  return { void: triggers.length > 0, triggers };
}
