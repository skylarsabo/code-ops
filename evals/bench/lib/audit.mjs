// Void audit for one benchmark unit (design: "Answer-key isolation"). Pure over strings.
//
//   auditUnit({ transcriptTexts, findingsText, repoRoot, runFolder, canary, upstream, allowedPaths })
//     -> { void, triggers: [{ rule, where, excerpt }] }
//
// Rules: repo-path (the repository root or the run folder inside a tool input), answer-key (the
// string ANSWER_KEY or the canary anywhere), upstream-fetch (the upstream name inside a network
// command, or in the input of a web tool). Paths compare case-insensitively with every run of
// slashes and backslashes folded to one slash, in drive form (c:/x) and MSYS form (/c/x). A path
// under an allowed path never triggers repo-path. An excerpt holds at most 120 characters and
// never the canary.

const NETWORK = /\b(?:curl|wget|git\s+(?:clone|fetch)|npm\s+(?:view|install)|npx|invoke-webrequest|iwr)\b/i;
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const EXCERPT = 120;

const fold = (s) => s.toLowerCase().replace(/[\\/]+/g, '/');
/** The folded forms one path can take in a tool input. */
function pathForms(p) {
  const f = fold(p).replace(/\/+$/, '');
  const drive = f.match(/^([a-z]):(\/.*)?$/);
  return drive ? [f, `/${drive[1]}${drive[2] ?? ''}`] : [f];
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

export function auditUnit({ transcriptTexts = [], findingsText = '', repoRoot, runFolder, canary, upstream, allowedPaths = [] }) {
  const triggers = [];
  const mask = (s) => (/^[0-9a-f]+$/i.test(canary ?? '') ? s.replace(new RegExp(canary, 'gi'), '<canary>') : s);
  // text must already be masked, so an index never points past a canary.
  const add = (rule, where, text, index) => {
    const from = Math.max(0, index - 40);
    triggers.push({ rule, where, excerpt: text.slice(from, from + EXCERPT).replace(/\s+/g, ' ') });
  };

  const names = [...new Set([].concat(upstream ?? []).flatMap((u) => [u, String(u).replace(/\/+$/, '').split('/').pop()])
    .map((n) => String(n).toLowerCase()).filter((n) => n !== ''))];
  const protectedForms = [repoRoot, runFolder].filter(Boolean).map(pathForms);
  const allowed = allowedPaths.flatMap(pathForms);

  const texts = [...transcriptTexts.map((t, i) => [`transcript[${i}]`, t]), ['findings', findingsText]];
  for (const [where, raw] of texts) {
    const text = mask(raw ?? '');
    const key = [text.indexOf('ANSWER_KEY'), text.indexOf('<canary>')].filter((i) => i !== -1).sort((x, y) => x - y)[0];
    if (key !== undefined) add('answer-key', where, text, key);
  }

  transcriptTexts.forEach((transcript, t) => {
    for (const { name, texts: inputs } of toolInputs(mask(transcript))) {
      const where = `transcript[${t}]`;
      for (const leaf of inputs) {
        const f = fold(leaf);
        const covered = allowed.flatMap((a) => spans(f, a));
        let hit = -1;
        for (const forms of protectedForms) {
          for (const form of forms) {
            for (const [s, e] of spans(f, form)) {
              if (!covered.some(([cs, ce]) => cs <= s && ce >= e) && (hit === -1 || s < hit)) hit = s;
            }
          }
        }
        if (hit !== -1) add('repo-path', where, f, hit);
        const lowLeaf = leaf.toLowerCase();
        const segments = WEB_TOOLS.has(name) ? [lowLeaf] : lowLeaf.split(/[;&|\n]+/).filter((s) => NETWORK.test(s));
        const seg = segments.find((s) => names.some((n) => s.includes(n)));
        if (seg !== undefined) add('upstream-fetch', where, seg, Math.min(...names.map((n) => seg.indexOf(n)).filter((i) => i !== -1)));
      }
    }
  });
  return { void: triggers.length > 0, triggers };
}
