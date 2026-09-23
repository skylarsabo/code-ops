// Copied into opencode-dist/plugins by scripts/build-opencode-dist.mjs. Do not edit the copy.
//
// OpenCode ports of the lifecycle mechanisms the host events can carry:
// ladder card, session receipt, handoff assess/nudge/pickup,
// dispatch guard (subagent round stop at twice the budget), context-ceiling
// dispatch gate on the lead, Task-tool suite allowlist, compact checkpoint,
// and chooser-aware cheapest-at-floor agent bindings.
//
// WHY: OpenCode has no SubagentStart, SessionEnd transcript_path, or PreToolUse
// agent_id. This plugin approximates them with sessionID, parentID, chat.params,
// system.transform, tool.execute, session.idle, tool.definition, and config.
// It ships in the generated distribution. It is not a claim that OpenCode has the
// Claude hook events. Fail-open on every path except a bound dispatch-guard stop,
// an unassessed dispatch past the context ceiling, or a non-suite Task dispatch.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const THRESHOLD = 150_000;
const MIN_THRESHOLD = 50_000;
// Tool output the lead pulls inline is re-read on every later turn. One band is
// about 30k tokens at four characters a token.
const INLINE_BAND = 120_000;
const REPORT_CHARS = 16_000;
const DEFAULT_BUDGET = 40;
const WARN_EVERY = 20;
const STOP_MULTIPLE = 2;
// Past this context size the lead must run the handoff assessment before it
// dispatches new work. Each later THRESHOLD-sized band gates again.
const CEILING = 300_000;
const PENDING_DAYS = 14;
const DISPATCH_TOOLS = new Set(['task', 'Task', 'agent', 'Agent']);
const WIDE_TYPES = new Set(['general-purpose', 'general', 'claude', 'fork', 'explore', 'scout']);
const READ_ONLY = new Set([
  'explorer', 'reviewer', 'tracer', 'verifier', 'gatherer', 'claim-checker',
  'privacy-reviewer', 'mech-review', 'plan', 'explore',
]);
const PLUGIN_PREFIXES = ['code-ops-suite-', 'privacy-opsec-suite-', 'rigor-', 'researcher-'];
const SUITE_TASK = {
  '*': 'deny',
  'code-ops-suite-*': 'allow',
  'privacy-opsec-suite-*': 'allow',
  'rigor-*': 'allow',
  'researcher-*': 'allow',
};
const SUITE_AGENTS = [
  'code-ops-suite-explorer — read-only map, locate, trace; never edits',
  'code-ops-suite-implementer — one bounded build, fix, or refactor; never general',
  'code-ops-suite-reviewer — skeptical review of a diff or file group; never edits',
  'privacy-opsec-suite-explorer — leak-aware read-only investigation',
  'privacy-opsec-suite-privacy-reviewer — anonymity/opsec review; regressions block',
  'rigor-tracer — end-to-end path or invariant trace; never executes',
  'rigor-verifier — write and run a minimal repro; never edits source under test',
  'researcher-claim-checker — refute one claim against code and sources',
  'researcher-gatherer — local-only evidence gather on one scoped question',
];
const TASK_ROUTE = [
  'code-ops subagent choice: dispatch only a suite agent through the Task tool.',
  'Build, fix, refactor -> code-ops-suite-implementer. Map/search -> code-ops-suite-explorer.',
  'Review -> code-ops-suite-reviewer. Trace -> rigor-tracer. Prove -> rigor-verifier.',
  'Never general, explore, scout, or general-purpose: those start from a wide tool surface.',
  'Name a Round budget in every brief. Fresh operative per unit, never fork or resume one.',
  'Ask each operative for a conclusion of at most 40 lines plus a Report path. Its reply lands in your context, and every later turn re-reads it.',
].join('\n');
const ASSESS_CARD = [
  'code-ops handoff assess: CONTINUE, COMPACT, or HANDOFF at a phase or workstream boundary.',
  'CONTINUE when the bounded objective progresses without urgent context pressure or a required transfer.',
  'COMPACT when the same task needs context relief. Persist decisions, rejected approaches, authority, dirty work, verification, open items, and worker ownership in run artifacts first.',
  'OpenCode compact is callable through the host compacting hook after that checkpoint. Do not claim a compact ran from a shell.',
  'HANDOFF for a new workstream, host or operator change, explicit session end, or recovery after failed compaction. Write HANDOFF.md only then.',
  'Do not create HANDOFF.md for CONTINUE or COMPACT. A v3/v4 run checkpoints with run-runtime.mjs before COMPACT or HANDOFF.',
  'Pickup advertises a pending HANDOFF.md; it does not resume it. Resume is /code-ops-suite-handoff resume "<path>".',
].join('\n');
const COMPACT_CHECKPOINT = [
  'Before this compact summary is used, durable run artifacts are the authority.',
  'A v3/v4 contract must already have run-runtime.mjs checkpoint recorded; if it has not, name that as pending operator work and do not invent a checkpoint.',
  'Preserve CONTINUE/COMPACT/HANDOFF only as already-recorded assess outcomes. Do not create HANDOFF.md from compaction.',
  'Reload bounded durable state after compact. Do not restore redacted values. Do not treat resume or fork as a fresh reset.',
].join('\n');
const AGENT_FLOORS = {
  'code-ops-suite-explorer': 'light',
  'code-ops-suite-implementer': 'strong',
  'code-ops-suite-reviewer': 'strong',
  'privacy-opsec-suite-explorer': 'light',
  'privacy-opsec-suite-privacy-reviewer': 'strong',
  'rigor-tracer': 'strong',
  'rigor-verifier': 'strong',
  'researcher-claim-checker': 'mid',
  'researcher-gatherer': 'light',
};
const TIER_RANK = { light: 0, mid: 1, strong: 2, frontier: 3 };
const TIER_NAMES = ['light', 'mid', 'strong', 'frontier'];
// `lead` is a tier clone with no model, so it inherits whatever the operator
// picked for the orchestrator session.
const TIER_SUFFIX = /-(light|mid|strong|frontier|lead)$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const BREADTH = new Set(['explorer', 'gatherer']);
const REVIEW = new Set(['reviewer', 'privacy-reviewer', 'tracer', 'verifier', 'claim-checker']);
const EFFORT_DEFAULT = { breadth: 'low', build: 'medium', review: 'high', 'claim-checker': 'medium' };
const HANDOFF_RE = /code-ops-suite[-:]handoff/;
const LADDER_CARD = [
  'Code-economy ladder (code-ops):',
  '1. Objective order: correctness and the safety floor, module boundaries, measured performance on hot paths, readability, then size. Fewer lines wins only between candidates equal on the first four.',
  '2. Does it need to exist? Scope is the request.',
  '3. Does it exist here? Search before you write.',
  '4. Does the standard library, the platform, or an installed dependency do it? Verify against current docs, never memory.',
  '5. Does it fit inside the owning module? Extend before you add a file.',
  '6. Extract only on evidence: a second caller, a unit that needs its own test, or a file past the repository\'s own size norm.',
  '7. Then write the minimum edge-case-correct implementation.',
  '8. Never trade algorithmic complexity for brevity on a measured hot path.',
  '9. Mark a deliberate simplification with a deferred(<ceiling>, <upgrade path>) comment.',
].join('\n');

const on = (name) => !/^(off|0|false)$/i.test(process.env[name] ?? '');
const slug = (value) => String(value).replace(/[^A-Za-z0-9]/g, '-');
const stateKey = (value) => createHash('sha256').update(String(value)).digest('hex');
const roundBudget = () => {
  const raw = Number(process.env.CODE_OPS_ROUND_BUDGET);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_BUDGET;
};
const hardStop = () => !/^warn$/i.test(process.env.CODE_OPS_DISPATCH_GUARD ?? '');

// A tier clone is the same role as its base agent. Every role check resolves
// the base first, so a clone never escapes a floor, a card, or the allowlist.
function baseAgent(name) {
  if (typeof name !== 'string') return '';
  const s = name.trim().toLowerCase();
  const base = s.replace(TIER_SUFFIX, '');
  return AGENT_FLOORS[base] !== undefined ? base : s;
}

function leafName(agentType) {
  if (typeof agentType !== 'string' || !agentType.trim()) return '';
  const s = baseAgent(agentType);
  if (s.includes(':')) return s.split(':').pop();
  for (const prefix of PLUGIN_PREFIXES) {
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  return s;
}

function implementerClass(agentType) {
  const leaf = leafName(agentType);
  if (!leaf) return false;
  if (READ_ONLY.has(leaf)) return false;
  return !/(explorer|reviewer)$/.test(leaf);
}

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pendingHandoff(cwd) {
  const roots = [cwd];
  let entries;
  try { entries = readdirSync(cwd, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('-docs')) roots.push(join(cwd, entry.name));
  }
  const cutoff = Date.now() - PENDING_DAYS * 86_400_000;
  let best = null;
  for (const root of roots) {
    const runs = join(root, '80 Runs');
    let folders;
    try { folders = readdirSync(runs, { withFileTypes: true }); } catch { continue; }
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const dir = join(runs, folder.name);
      if (existsSync(join(dir, 'HANDOFF.consumed'))) continue;
      const file = join(dir, 'HANDOFF.md');
      let mtime;
      try { mtime = statSync(file).mtimeMs; } catch { continue; }
      if (mtime < cutoff) continue;
      if (!best || mtime > best.mtime) best = { file, mtime };
    }
  }
  if (!best) return null;
  return { path: relative(cwd, best.file).split(sep).join('/'), written: localDate(best.mtime) };
}

function ledgerPath() {
  const named = process.env.CODE_OPS_RECEIPTS;
  if (named && !/^(off|0|false)$/i.test(named)) return named;
  return join(homedir(), '.claude', 'code-ops', 'session-receipts.jsonl');
}

// One cumulative row per session per idle. A reader keeps the last row of each
// session, so a long session is measured at its end, not at its first pause.
function costLedgerPath() {
  const named = process.env.CODE_OPS_COST_LEDGER;
  if (named && /^(off|0|false)$/i.test(named)) return null;
  return named || join(homedir(), '.claude', 'code-ops', 'opencode-cost.jsonl');
}

function hostHome() {
  return join(homedir(), '.claude');
}

function handoffMarkerPath(cwd, sessionId) {
  return join(hostHome(), 'code-ops', 'handoff', slug(cwd), `${slug(sessionId)}.json`);
}

function lastBand(path) {
  try { return Math.max(0, Number(JSON.parse(readFileSync(path, 'utf8')).band) || 0); } catch { return 0; }
}

function peakBand(path) {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    return Math.max(0, Number(m.peak) || 0, Number(m.band) || 0);
  } catch { return 0; }
}

function writeBand(path, band, peak) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ v: 1, band, peak: Math.max(peak, band), ts: new Date().toISOString() }));
}

function contextSize(tokens) {
  if (!tokens || typeof tokens !== 'object') return null;
  const input = Number(tokens.input) || 0;
  const cacheRead = Number(tokens.cache?.read ?? tokens.cacheRead) || 0;
  const cacheWrite = Number(tokens.cache?.write ?? tokens.cacheCreate) || 0;
  const total = input + cacheRead + cacheWrite;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

// The profile may lower the handoff band for a credit-metered host. It never
// goes below MIN_THRESHOLD, so a typo cannot make the card fire every turn.
function contextThreshold(profile) {
  const raw = Number(process.env.CODE_OPS_CONTEXT_THRESHOLD ?? profile?.context_threshold);
  return Number.isSafeInteger(raw) && raw >= MIN_THRESHOLD ? raw : THRESHOLD;
}

// CODE_OPS_CONTEXT_CEILING: off|0|false disables the gate, an integer of at
// least THRESHOLD overrides it, anything else keeps the default. The ceiling
// never sits below the handoff band the profile set.
function contextCeiling(profile) {
  const raw = String(process.env.CODE_OPS_CONTEXT_CEILING ?? '').trim();
  if (/^(off|0|false)$/i.test(raw)) return null;
  const n = Number(raw);
  const ceiling = raw && Number.isSafeInteger(n) && n >= THRESHOLD ? n : CEILING;
  return Math.max(ceiling, contextThreshold(profile));
}

function gateBand(context, ceiling) {
  if (!ceiling || !(context >= ceiling)) return 0;
  return 1 + Math.floor((context - ceiling) / THRESHOLD);
}

// Host-reported spend, converted by the operator's own measured rate. A host
// that reports zero cost yields no line rather than a false zero.
function spendLine(usd, profile) {
  if (!(usd > 0)) return '';
  const rate = Number(profile?.credits_per_usd);
  const cap = Number(profile?.budget_credits);
  if (!(rate > 0)) return `Host-reported spend so far: about $${usd.toFixed(2)}. `;
  const credits = usd * rate;
  const share = cap > 0 ? `, ${(credits / cap * 100).toFixed(1)}% of the ${cap.toLocaleString('en-US')}-credit budget` : '';
  return `Host-reported spend so far: about $${usd.toFixed(2)} (about ${Math.round(credits)} credits${share}). `;
}

// Appended to a text part the host already stores, so the note sits at the tail
// of the conversation and the cached prefix above it stays valid.
function appendToUserText(output, notes) {
  if (!notes.length || !Array.isArray(output?.parts)) return false;
  const texts = output.parts.filter((part) => part?.type === 'text' && typeof part.text === 'string');
  const last = texts[texts.length - 1];
  if (!last) return false;
  last.text = `${last.text}\n\n${notes.join('\n')}`;
  return true;
}

function emptyUsage() {
  return { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0, total: 0 };
}

function addUsage(into, tokens) {
  if (!tokens || typeof tokens !== 'object') return;
  into.input += Number(tokens.input) || 0;
  into.cacheRead += Number(tokens.cache?.read ?? tokens.cacheRead) || 0;
  into.cacheCreate += Number(tokens.cache?.write ?? tokens.cacheCreate) || 0;
  into.output += Number(tokens.output) || 0;
  into.thinking += Number(tokens.reasoning ?? tokens.thinking) || 0;
  into.total = into.input + into.cacheRead + into.cacheCreate + into.output + into.thinking;
}

// message.updated fires more than once per message. Keyed by message, the last
// update wins and nothing is counted twice.
function sessionUsage(row) {
  const usage = emptyUsage();
  for (const m of row.messages.values()) addUsage(usage, m.tokens);
  return usage;
}

function sessionCost(row) {
  let usd = 0;
  for (const m of row.messages.values()) usd += m.cost;
  return usd;
}

function peakContext(row) {
  let peak = 0;
  for (const m of row.messages.values()) peak = Math.max(peak, contextSize(m.tokens) ?? 0);
  return peak;
}

function stripUsage(u) {
  return { input: u.input, cacheRead: u.cacheRead, cacheCreate: u.cacheCreate, output: u.output, thinking: u.thinking, total: u.total };
}

function sessionStore(cwd) {
  return join(hostHome(), 'code-ops', 'dispatch', stateKey(cwd));
}

function counterPath(cwd, sessionId) {
  return join(sessionStore(cwd), `${stateKey(sessionId)}.rounds`);
}

function assessedPath(cwd, sessionId) {
  return join(sessionStore(cwd), `${stateKey(sessionId)}.assessed.json`);
}

function readAssessed(path) {
  try { return Math.max(0, Number(JSON.parse(readFileSync(path, 'utf8')).band) || 0); } catch { return 0; }
}

function countRound(path) {
  try {
    appendFileSync(path, '.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, '.');
  }
  return statSync(path).size;
}

function dispatchType(args) {
  if (!args || typeof args !== 'object') return '';
  const raw = args.subagent_type ?? args.agent ?? args.subagentType ?? args.name;
  return typeof raw === 'string' ? raw.trim() : '';
}

function dispatchPrompt(args) {
  if (!args || typeof args !== 'object') return '';
  return typeof args.prompt === 'string' ? args.prompt : '';
}

function dispatchModel(args) {
  if (!args || typeof args !== 'object') return undefined;
  return args.model;
}

function suiteAgent(name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  const s = name.trim().toLowerCase();
  return PLUGIN_PREFIXES.some((prefix) => s.startsWith(prefix) || s.startsWith(prefix.replace(/-$/, ':')));
}

function parseChooserLine(line) {
  const text = String(line).trim();
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(text)) return null;
  return text;
}

function listChooserModels(raw) {
  if (typeof raw === 'string') {
    return raw.split(/\r?\n/).map(parseChooserLine).filter(Boolean);
  }
  const env = process.env.CODE_OPS_OPENCODE_MODELS;
  if (typeof env === 'string' && env.trim()) {
    return env.split(/[\n,]/).map(parseChooserLine).filter(Boolean);
  }
  return readChooserCache();
}

// WHY a cache and never a subprocess: this plugin runs inside the host it would
// be asking. `opencode models` loads this plugin again, whose config hook asks
// again, and the chain of blocked hosts never ends. The config hook therefore
// reads only what a previous session learned from the host client.
function chooserCachePath() {
  const env = process.env.CODE_OPS_CHOOSER_CACHE;
  if (typeof env === 'string' && env.trim()) return env.trim();
  return join(homedir(), '.claude', 'code-ops', 'opencode-chooser-models.json');
}

// Two hosts can share this machine and list different models: a vendor CLI and
// the desktop app. Each keeps its own list, keyed by the binary that runs it.
const hostKey = () => basename(process.execPath);

function readCacheFile() {
  try {
    const data = JSON.parse(readFileSync(chooserCachePath(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function readChooserCache() {
  const ids = readCacheFile().hosts?.[hostKey()]?.ids;
  return Array.isArray(ids) ? ids.map(parseChooserLine).filter(Boolean) : [];
}

// The host lists only the providers this user is connected to, so the catalog
// never names a model the user cannot reach.
async function refreshChooserCache(client) {
  if (typeof client?.config?.providers !== 'function') return null;
  const limit = new Promise((resolve) => { setTimeout(resolve, 5000, null).unref?.(); });
  const res = await Promise.race([client.config.providers(), limit]);
  const providers = res?.data?.providers ?? res?.providers;
  if (!Array.isArray(providers)) return null;
  const ids = providers
    .flatMap((p) => Object.keys(p?.models ?? {}).map((model) => parseChooserLine(`${p?.id}/${model}`)))
    .filter(Boolean)
    .sort();
  if (!ids.length) return null;
  const changed = JSON.stringify(ids) !== JSON.stringify(readChooserCache().slice().sort());
  if (changed) {
    const path = chooserCachePath();
    mkdirSync(dirname(path), { recursive: true });
    const hosts = { ...readCacheFile().hosts, [hostKey()]: { ids } };
    writeFileSync(path, `${JSON.stringify({ hosts }, null, 2)}\n`);
  }
  const variants = {};
  for (const p of providers) {
    for (const [model, info] of Object.entries(p?.models ?? {})) {
      if (info?.variants && Object.keys(info.variants).length) variants[`${p.id}/${model}`] = info.variants;
    }
  }
  return { ids, changed, variants };
}

// The operator's model profile: measured quality, cost, and speed per model id,
// the enabled list, and the ranking weights. Absent file, absent behavior.
function readProfile() {
  const path = process.env.CODE_OPS_MODEL_PROFILE?.trim()
    || join(homedir(), '.claude', 'code-ops', 'opencode-model-profile.json');
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

const bareId = (fullId) => {
  const id = String(fullId).toLowerCase();
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
};

// The floor gate owns the verified tier table. Reading it from the sibling file
// keeps one table. A model reached through a reseller is the same model, so the
// lookup also goes by bare id and takes the lowest tier any provider row gives.
let gateTable;
function gateTier(fullId) {
  if (gateTable === undefined) {
    gateTable = null;
    try {
      const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'code-ops-model-floors.js'), 'utf8');
      const known = JSON.parse(/const KNOWN_MODELS = (\{[\s\S]*?\n\});/.exec(text)[1]);
      const byId = {};
      for (const models of Object.values(known)) {
        for (const [id, tier] of Object.entries(models)) {
          if (byId[id] === undefined || TIER_RANK[tier] < TIER_RANK[byId[id]]) byId[id] = tier;
        }
      }
      const prices = /const MODEL_PRICES = (\{[\s\S]*?\n\});/.exec(text);
      gateTable = { known, byId, prices: prices ? JSON.parse(prices[1]) : {} };
    } catch { /* fall back to the family classifier */ }
  }
  const id = String(fullId).toLowerCase();
  const provider = id.includes('/') ? id.slice(0, id.indexOf('/')) : '';
  const verified = gateTable?.known?.[provider]?.[bareId(id)] ?? gateTable?.byId?.[bareId(id)];
  if (verified) return verified;
  // A loaded floor table is the gate. A family guess would bind a model the gate rejects.
  if (gateTable) return null;
  return familyTier(id);
}

const profileRow = (fullId, profile) => profile?.models?.[String(fullId).toLowerCase()] ?? profile?.models?.[bareId(fullId)];

function indexTier(index) {
  if (index >= 43) return 'frontier';
  if (index >= 36) return 'strong';
  if (index >= 28) return 'mid';
  return 'light';
}

// A measured index can lower a model's rung but never raise it past the gate's
// tier, so every binding the ladder makes is one the floor gate accepts.
function classifyChooserModel(fullId, profile = {}) {
  const gate = gateTier(fullId);
  // The operator may place a model the gate recognizes on any rung. The gate
  // still enforces every agent floor on its own, and a model the gate does not
  // recognize stays unbound whatever the profile says.
  const forced = profileRow(fullId, profile)?.tier;
  if (gate && TIER_RANK[forced] !== undefined) return forced;
  const index = Number(profileRow(fullId, profile)?.index);
  if (!gate || !Number.isFinite(index)) return gate;
  const measured = indexTier(index);
  return TIER_RANK[measured] < TIER_RANK[gate] ? measured : gate;
}

const WEIGHTS = {
  balanced: { cost: 0.35, speed: 0.15 },
  lean: { cost: 0.6, speed: 0.15 },
  quality: { cost: 0.15, speed: 0.05 },
};

// Value of one model inside a tier: quality first, discounted by what a task
// costs and by how many tokens it takes to finish. `credits` overrides `cost`
// when the operator knows the plan's own price for the model.
function valueScore(row, profile) {
  const w = { ...WEIGHTS[profile?.mode] ?? WEIGHTS.balanced, ...profile?.weights };
  const index = Number(row?.index);
  const cost = Number(row?.credits ?? row?.cost);
  const tokens = Number(row?.tokens);
  if (!Number.isFinite(index) || !(cost > 0)) return null;
  return index / (cost ** w.cost * (tokens > 0 ? tokens / 1000 : 30) ** w.speed);
}

// Enabled means: on the operator's list when the profile has one, and never a
// model the desktop app's Models settings hide.
function enabledModels(catalog, profile) {
  let ids = catalog;
  if (Array.isArray(profile?.enabled) && profile.enabled.length) {
    const allow = new Set(profile.enabled.map((id) => String(id).toLowerCase()));
    // A list that names nothing this host offers describes another host.
    const listed = ids.filter((id) => allow.has(id.toLowerCase()) || allow.has(bareId(id)));
    if (listed.length) ids = listed;
  }
  try {
    const home = homedir();
    const stores = process.env.CODE_OPS_DESKTOP_STORE?.trim()
      ? [process.env.CODE_OPS_DESKTOP_STORE.trim()]
      : [
        join(home, 'Library', 'Application Support', 'ai.opencode.desktop', 'opencode.global.dat'),
        join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai.opencode.desktop', 'opencode.global.dat'),
        join(home, '.config', 'opencode', 'opencode.global.dat'),
      ];
    const store = stores.find((path) => existsSync(path));
    if (!store) return ids;
    let model = JSON.parse(readFileSync(store, 'utf8')).model;
    if (typeof model === 'string') model = JSON.parse(model);
    const hidden = new Set((model?.user ?? [])
      .filter((row) => row?.visibility === 'hide')
      .map((row) => `${row.providerID}/${row.modelID}`.toLowerCase()));
    if (hidden.size) ids = ids.filter((id) => !hidden.has(id.toLowerCase()));
  } catch { /* no desktop store on this host */ }
  return ids;
}

function familyTier(fullId) {
  const id = String(fullId).toLowerCase();
  const name = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
  if (/fable|opus-4\.6|gpt-5\.4$|gpt-5\.6-sol|gpt-6-sol|gpt-6-astra|gemini-3\.1-pro|grok-4\.[67]/.test(name)) return 'frontier';
  if (/sonnet|gemini-3-flash|gpt-4o|codex-mini|medium/.test(name) && !/opus|pro/.test(name)) return 'mid';
  if (/luna|haiku|flash-lite|grok-code-fast|grok-build|gpt-4\.1$|gpt-5-mini|gpt-5\.\d-mini|small/.test(name) && !/pro|opus|sonnet|codex/.test(name)) return 'light';
  if (/opus|gpt-5|codex|gemini-.*pro|claude-latest|pro/.test(name)) return 'strong';
  if (/grok/.test(name)) return 'strong';
  return null;
}

function costScore(fullId) {
  const name = String(fullId).toLowerCase();
  const id = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
  if (/codex-mini/.test(id)) return 8;
  if (/sonnet/.test(id)) return 12;
  if (/luna|grok-code-fast|grok-build|flash-lite|haiku|gpt-5-mini|gpt-5\.\d-mini|small/.test(id) && !/pro|opus|sonnet|codex/.test(id)) return 0;
  if (/flash|gpt-4o|medium/.test(id) && !/pro|opus/.test(id)) return 8;
  if (/codex/.test(id) && !/max/.test(id)) return 16;
  if (/codex-max/.test(id)) return 17;
  if (/opus|pro|gpt-5/.test(id)) return 20;
  if (/fable|sol/.test(id)) return 24;
  return 30;
}

// Per-million prices for one model: the profile's `prices` first, by full then
// bare id, then the shipped table for that exact provider. A shipped price is a
// provider's own bill, so a reseller of the same bare id never inherits it.
function priceOf(fullId, profile) {
  const id = String(fullId).toLowerCase();
  const own = profile?.prices?.[id] ?? profile?.prices?.[bareId(id)];
  if (own) return own;
  gateTier(id);
  const provider = id.includes('/') ? id.slice(0, id.indexOf('/')) : '';
  return gateTable?.prices?.[provider]?.[bareId(id)] ?? null;
}

// USD for a standard operative workload: 1M cached input, 60k fresh input
// written to cache, and 15k output. Spend follows context re-reads, so the
// cached rate dominates.
function workloadCost(price) {
  if (!price) return null;
  const cost = Number(price.cached ?? price.input ?? 0) + 0.06 * Number(price.cacheWrite ?? price.input ?? 0)
    + 0.015 * Number(price.output ?? 0);
  return Number.isFinite(cost) ? cost : null;
}

function qualityScore(fullId) {
  const name = String(fullId).toLowerCase().replace(/opus-41/, 'opus-4.1');
  const nums = [...name.matchAll(/(\d+)(?:\.(\d+))?/g)].map((m) => Number(m[1]) * 100 + Number(m[2] || 0));
  return nums.reduce((a, b) => a + b, 0);
}

function pickChooserModel(required, catalog, profile = {}) {
  const need = TIER_RANK[required];
  if (need === undefined) return null;
  const eligible = catalog
    .map((id) => ({
      id,
      tier: classifyChooserModel(id, profile),
      value: valueScore(profileRow(id, profile), profile),
      cost: workloadCost(priceOf(id, profile)),
    }))
    .filter((row) => row.tier && TIER_RANK[row.tier] >= need && !String(row.id).toLowerCase().startsWith('opencode/'));
  if (!eligible.length) return null;
  // A measured model outranks an unmeasured one. Among unmeasured ones a priced
  // model ranks by its workload cost ahead of an unpriced one, which keeps the
  // family order.
  eligible.sort((a, b) => (b.value !== null) - (a.value !== null)
    || (b.value ?? 0) - (a.value ?? 0)
    || (b.cost !== null) - (a.cost !== null)
    || (a.cost ?? 0) - (b.cost ?? 0)
    || costScore(a.id) - costScore(b.id) || qualityScore(b.id) - qualityScore(a.id));
  return eligible[0].id;
}

function buildChooserLadder(catalog = listChooserModels(), profile = readProfile()) {
  const ids = enabledModels(catalog.length ? catalog : [], profile);
  const byTier = {};
  for (const tier of ['light', 'mid', 'strong', 'frontier']) {
    byTier[tier] = pickChooserModel(tier, ids, profile);
  }
  if (!byTier.frontier) byTier.frontier = byTier.strong;
  if (!byTier.strong) byTier.strong = byTier.mid || byTier.light;
  if (!byTier.mid) byTier.mid = byTier.strong || byTier.light;
  if (!byTier.light) byTier.light = byTier.mid || byTier.strong;
  const agents = {};
  for (const [agent, floor] of Object.entries(AGENT_FLOORS)) {
    const model = byTier[floor];
    if (model) agents[agent] = model;
  }
  return { byTier, agents, catalog: ids, profile };
}

function chooserKnownModels(catalog) {
  const out = {};
  for (const id of catalog) {
    const tier = classifyChooserModel(id);
    if (!tier || !id.includes('/')) continue;
    const provider = id.slice(0, id.indexOf('/'));
    const model = id.slice(id.indexOf('/') + 1);
    out[provider] ??= {};
    const prev = out[provider][model];
    if (prev === undefined || TIER_RANK[tier] > TIER_RANK[prev]) out[provider][model] = tier;
  }
  return out;
}

function directive(text, key, allowed) {
  const m = new RegExp(`^[ \\t>*_-]*${key}[*_]*[ \\t]*:[*_ \\t]*([a-z]+)`, 'im').exec(String(text ?? ''));
  if (!m) return { value: null, raw: null };
  const raw = m[1].toLowerCase();
  return { value: allowed.includes(raw) ? raw : null, raw };
}

// Tier rides on the agent name because the Task tool has no model argument.
function routeTier(type, requested, clones) {
  const base = baseAgent(type);
  const floor = AGENT_FLOORS[base];
  if (floor === undefined || !requested) return { agent: type, note: null };
  if (requested !== 'lead' && TIER_RANK[requested] <= TIER_RANK[floor]) {
    const raised = TIER_RANK[requested] < TIER_RANK[floor];
    return { agent: base, note: raised ? `Tier ${requested} is below the ${floor} floor of ${base}; it runs at ${floor}.` : null };
  }
  const clone = `${base}-${requested}`;
  if (clones.has(clone)) return { agent: clone, note: null };
  if (clones.has(`same:${clone}`)) return { agent: base, note: null };
  return { agent: base, note: `No ${requested} binding for ${base} on this host; it runs at its ${floor} binding. Restart OpenCode after the first launch so tier clones exist.` };
}

function effortClass(agent) {
  const leaf = leafName(agent);
  if (BREADTH.has(leaf)) return 'breadth';
  if (REVIEW.has(leaf)) return 'review';
  return 'build';
}

// Effort follows ambiguity: never low for review, never highest for breadth.
function resolveEffort(agent, requested) {
  const kind = effortClass(agent);
  let level = requested ?? EFFORT_DEFAULT[leafName(agent)] ?? EFFORT_DEFAULT[kind];
  if (kind === 'review' && level === 'low') level = 'medium';
  if (kind === 'breadth' && level === 'xhigh') level = 'high';
  return { level, explicit: Boolean(requested) };
}

// Only the host's own variant payloads are applied, never an invented option.
function pickVariant(variants, level) {
  if (!variants || typeof variants !== 'object') return null;
  const keys = Object.keys(variants);
  const scale = EFFORTS.filter((k) => keys.includes(k));
  const want = EFFORTS.indexOf(level);
  if (scale.length) {
    const name = scale.filter((k) => EFFORTS.indexOf(k) <= want).pop() ?? scale[0];
    return { name, options: variants[name] };
  }
  if (keys.includes('thinking') && want >= EFFORTS.indexOf('high')) return { name: 'thinking', options: variants.thinking };
  return null;
}

function routingCard(byTier, profile) {
  const bound = TIER_NAMES.map((t) => {
    const row = byTier?.[t] ? profileRow(byTier[t], profile) : null;
    const measured = row ? ` (index ${row.index}, $${row.credits ?? row.cost} per task, ${row.tokens} output tokens)` : '';
    return `${t}=${byTier?.[t] ?? 'unbound'}${measured}`;
  }).join(', ');
  const budget = profile?.budget
    ? [
      `This host runs on a budget of ${profile.budget}. Choose the lowest tier and effort the unit's judgment allows, and escalate on evidence, never by default.`,
      'Spend follows context size times turns, not output: every turn re-reads the whole context. Keep your own context small. Hand reading, search, and log triage to light-tier explorers that return a conclusion, read file ranges instead of whole files, and assess handoff at the context band instead of pushing through it.',
    ]
    : [];
  return [
    ...budget,
    'code-ops tier and effort routing: choose both per unit, from the task. Add either line to a Task brief.',
    `Tier: light | mid | strong | frontier | lead. This host binds ${bound}. lead inherits your own model.`,
    'A tier below the agent floor runs at the floor: explorer and gatherer light, claim-checker mid, every other suite agent strong.',
    'Effort: low | medium | high | xhigh sets that subagent\'s reasoning level. With no line: breadth low, implementer and claim-checker medium, review, trace, and verify high.',
    'Tier follows the judgment the unit needs. Effort follows its ambiguity. Review never runs low. Breadth never runs xhigh.',
  ].join('\n');
}

function routingLog(entry) {
  const path = process.env.CODE_OPS_ROUTING_LOG;
  if (!path || /^(off|0|false)$/i.test(path)) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch { /* fail open */ }
}

function rewriteTaskDefinition(output, byTier, profile) {
  if (!output || typeof output !== 'object') return;
  const listed = SUITE_AGENTS.map((line) => `- ${line}`).join('\n');
  const extra = [
    'Delegate one independently briefable unit to a code-ops suite subagent.',
    'Allowed subagents only:',
    listed,
    'Never invoke general, explore, scout, or general-purpose.',
    'Each brief names Objective, Scope, Round budget, Report path, and Escalation.',
    routingCard(byTier, profile),
  ].join('\n');
  const desc = typeof output.description === 'string' ? output.description : '';
  output.description = desc
    ? `${extra}\n\n${desc.replace(/\b(general|explore|scout|general-purpose)\b/gi, 'suite-subagent')}`
    : extra;
  const params = output.parameters;
  if (!params || typeof params !== 'object') return;
  const props = params.properties ?? params;
  for (const key of ['subagent_type', 'agent', 'subagentType', 'name']) {
    const field = props?.[key];
    if (!field || typeof field !== 'object') continue;
    field.description = 'Suite subagent name only: code-ops-suite-implementer, code-ops-suite-explorer, code-ops-suite-reviewer, privacy-opsec-suite-explorer, privacy-opsec-suite-privacy-reviewer, rigor-tracer, rigor-verifier, researcher-claim-checker, or researcher-gatherer.';
    if (Array.isArray(field.enum)) {
      field.enum = field.enum.filter((value) => suiteAgent(String(value)));
    }
  }
}

export const CodeOpsLifecycle = async ({ directory = process.cwd(), client } = {}) => {
  const sessions = new Map();

  const record = (sessionID) => {
    if (typeof sessionID !== 'string' || !sessionID) return null;
    let row = sessions.get(sessionID);
    if (!row) {
      row = {
        id: sessionID,
        parentID: null,
        agent: null,
        cwd: directory,
        models: new Set(),
        toolCalls: Object.create(null),
        toolResultChars: 0,
        messages: new Map(),
        inlineChars: 0,
        inlineBand: 0,
        childCost: 0,
        contextAtEnd: 0,
        firstTs: Date.now(),
        lastTs: Date.now(),
        userPrompts: 0,
        handoffInvoked: false,
        assessedBand: null,
        pickupDone: false,
        ladderDone: false,
        ladderViaSystem: false,
        pickupText: null,
        effort: null,
        effortRaw: null,
        parentChecked: false,
        pendingNotes: [],
        receiptWritten: false,
        childUsage: emptyUsage(),
      };
      sessions.set(sessionID, row);
    }
    return row;
  };

  const rememberParent = (info) => {
    if (!info || typeof info.id !== 'string') return;
    const row = record(info.id);
    if (typeof info.parentID === 'string' && info.parentID) row.parentID = info.parentID;
    if (typeof info.directory === 'string' && info.directory) row.cwd = info.directory;
  };

  const isSubagent = (row) => Boolean(row?.parentID);

  const queueNote = (row, note) => {
    if (!row || !note) return;
    if (!row.pendingNotes.includes(note)) row.pendingNotes.push(note);
  };

  // The assessed band survives a restart through a marker beside the round
  // counter. It only rises, so a stale write never re-locks an unlocked band.
  const assessedBand = (row) => {
    row.assessedBand ??= readAssessed(assessedPath(row.cwd, row.id));
    return row.assessedBand;
  };

  const recordAssessment = (row) => {
    const band = gateBand(row.contextAtEnd, contextCeiling(profile));
    if (band <= assessedBand(row)) return;
    row.assessedBand = band;
    try {
      const path = assessedPath(row.cwd, row.id);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ version: 1, band }));
    } catch { /* fail open: the row still holds the band */ }
  };

  const takeNotes = (row) => {
    if (!row?.pendingNotes.length) return [];
    const notes = row.pendingNotes.slice();
    row.pendingNotes.length = 0;
    return notes;
  };

  const writeReceipt = (row, reason) => {
    if (!row || row.receiptWritten) return;
    if (!on('CODE_OPS_RECEIPTS') && !process.env.CODE_OPS_RECEIPTS) return;
    if (/^(off|0|false)$/i.test(process.env.CODE_OPS_RECEIPTS ?? '')) return;
    try {
      const out = ledgerPath();
      mkdirSync(dirname(out), { recursive: true });
      const marker = handoffMarkerPath(row.cwd, row.id);
      const payload = {
        v: 1,
        ts: new Date().toISOString(),
        sessionId: row.id,
        cwd: row.cwd,
        reason: reason ?? null,
        durationMs: Math.max(0, row.lastTs - row.firstTs),
        models: [...row.models],
        turns: row.messages.size,
        toolCalls: row.toolCalls,
        toolResultChars: row.toolResultChars,
        contextAtEnd: row.contextAtEnd,
        arms: {
          digest: on('CODE_OPS_DIGEST'),
          ladderCard: on('CODE_OPS_LADDER_CARD'),
          index: on('CODE_OPS_INDEX'),
          handoffCard: on('CODE_OPS_HANDOFF_CARD'),
          handoffPickup: on('CODE_OPS_HANDOFF_PICKUP'),
          dispatchGuard: on('CODE_OPS_DISPATCH_GUARD'),
        },
        handoff: { band: peakBand(marker), invoked: row.handoffInvoked },
        files: 1,
        skipped: 0,
        tokens: { main: stripUsage(sessionUsage(row)), subagents: stripUsage(row.childUsage) },
        costUsd: { main: sessionCost(row), subagents: row.childCost },
        host: 'opencode',
      };
      appendFileSync(out, JSON.stringify(payload) + '\n');
      row.receiptWritten = true;
    } catch { /* fail open */ }
  };

  const writeCostRow = (row, reason) => {
    const out = costLedgerPath();
    if (!out || !row?.messages.size) return;
    try {
      const usage = sessionUsage(row);
      const usd = sessionCost(row);
      const rate = Number(profile?.credits_per_usd);
      mkdirSync(dirname(out), { recursive: true });
      appendFileSync(out, JSON.stringify({
        v: 1,
        ts: new Date().toISOString(),
        sessionId: row.id,
        parentId: row.parentID,
        cwd: row.cwd,
        host: hostKey(),
        reason,
        agent: row.agent,
        models: [...row.models],
        turns: row.messages.size,
        userPrompts: row.userPrompts,
        dispatches: [...DISPATCH_TOOLS].reduce((n, t) => n + (row.toolCalls[t] || 0), 0),
        toolCalls: Object.values(row.toolCalls).reduce((n, c) => n + c, 0),
        toolResultChars: row.toolResultChars,
        contextAtEnd: row.contextAtEnd,
        contextPeak: peakContext(row),
        tokens: stripUsage(usage),
        cacheHitRate: usage.input + usage.cacheRead + usage.cacheCreate > 0
          ? usage.cacheRead / (usage.input + usage.cacheRead + usage.cacheCreate)
          : null,
        costUsd: usd,
        credits: rate > 0 ? usd * rate : null,
        handoffBand: peakBand(handoffMarkerPath(row.cwd, row.id)),
      }) + '\n');
    } catch { /* fail open */ }
  };

  const nudgeFor = (row) => {
    if (!on('CODE_OPS_HANDOFF_CARD') || isSubagent(row)) return null;
    const context = row.contextAtEnd;
    if (!context) return null;
    const band = Math.floor(context / contextThreshold(profile));
    const marker = handoffMarkerPath(row.cwd, row.id);
    const seen = lastBand(marker);
    const peak = peakBand(marker);
    if (band === 0) {
      if (seen !== 0) writeBand(marker, 0, peak);
      return null;
    }
    if (band <= seen) return null;
    writeBand(marker, band, peak);
    const approx = Math.round(context / 10_000) * 10_000;
    const held = `This session holds approximately ${approx.toLocaleString('en-US')} tokens of context, and every turn re-reads all of it. ${spendLine(sessionCost(row) + row.childCost, profile)}`;
    const ceiling = contextCeiling(profile);
    const gated = on('CODE_OPS_DISPATCH_GUARD') && hardStop() && ceiling && context >= ceiling
      && assessedBand(row) < gateBand(context, ceiling)
      ? ' New dispatches are gated until that assessment runs.'
      : '';
    return (band === 1
      ? held + 'At the next safe boundary, run /code-ops-suite-handoff assess to choose CONTINUE, COMPACT, or HANDOFF. Continue a short coherent finish; checkpoint durable state before compacting; use explicit write only for a transfer or recovery.'
      : held + 'Finish the step in flight, then run /code-ops-suite-handoff assess to choose CONTINUE, COMPACT, or HANDOFF before starting a new workstream. Checkpoint durable state first. This advisory band does not prove an earlier warning was seen; a host /compact action is pending operator action unless a callable capability executes it.') + gated;
  };

  // The lead's own reads are the largest cost on a metered host. The advisory
  // fires once per band of inline output since the last dispatch.
  const inlineNote = (row, tool, chars) => {
    if (!on('CODE_OPS_INLINE_NUDGE') || isSubagent(row)) return null;
    if (DISPATCH_TOOLS.has(tool)) {
      row.inlineChars = 0;
      row.inlineBand = 0;
      return chars > REPORT_CHARS
        ? `Lead context: this operative reply added about ${Math.round(chars / 4000)}k tokens that every later turn re-reads. Ask for a conclusion of at most 40 lines plus a Report path.`
        : null;
    }
    row.inlineChars += chars;
    const band = Math.floor(row.inlineChars / INLINE_BAND);
    if (band <= row.inlineBand) return null;
    row.inlineBand = band;
    return `Lead context: about ${Math.round(row.inlineChars / 4000)}k tokens of tool output pulled inline since the last dispatch, re-read on every later turn. Hand the remaining reading or search to code-ops-suite-explorer (Tier: light, Effort: low) with a Report path, and keep only its conclusion. Judgment stays with you.`;
  };

  const pickupLine = (row) => {
    if (!on('CODE_OPS_HANDOFF_PICKUP') || row.pickupDone) return null;
    if (isSubagent(row) || row.userPrompts > 0 || row.messages.size > 0) {
      row.pickupDone = true;
      return null;
    }
    row.pickupDone = true;
    const pending = pendingHandoff(row.cwd);
    if (!pending) return null;
    return `pending handoff: ${pending.path} (written ${pending.written}). Pickup is discovery, not resume. Before other work, run /code-ops-suite-handoff resume "${pending.path}", verify its claims, and open your reply with a recap under five headings: work completed, key findings, in progress, left to do, project scope and constraints. If the operator's first request is unrelated, name the pending handoff in one line and proceed with their request.`;
  };

  const mergeChildReceipt = (row) => {
    if (!row?.parentID) return;
    const parent = sessions.get(row.parentID);
    if (!parent) return;
    // Idle can fire more than once per child. Only the growth since the last
    // merge is added, so the parent never counts a child twice.
    const usage = sessionUsage(row);
    const seen = row.mergedUsage ?? emptyUsage();
    addUsage(parent.childUsage, {
      input: usage.input - seen.input,
      cache: { read: usage.cacheRead - seen.cacheRead, write: usage.cacheCreate - seen.cacheCreate },
      output: usage.output - seen.output,
      reasoning: usage.thinking - seen.thinking,
    });
    row.mergedUsage = usage;
    const usd = sessionCost(row);
    parent.childCost += usd - (row.mergedCost ?? 0);
    row.mergedCost = usd;
  };

  let chooserRefreshed = false;
  let live = null;
  let byTier = {};
  let profile = {};
  const clones = new Set();
  const agentModels = {};

  const buildClones = (config) => {
    for (const [base, floor] of Object.entries(AGENT_FLOORS)) {
      const src = config.agent[base];
      if (!src || (!src.prompt && !src.description)) continue;
      if (typeof src.model === 'string') agentModels[base] = src.model;
      const make = (tier, model) => {
        const copy = JSON.parse(JSON.stringify(src));
        if (model) copy.model = model; else delete copy.model;
        copy.hidden = true;
        copy.description = `${src.description ?? base} (${tier} tier)`;
        const name = `${base}-${tier}`;
        if ('name' in copy) copy.name = name;
        config.agent[name] ??= copy;
        clones.add(name);
        if (model) agentModels[name] = model;
      };
      for (const tier of TIER_NAMES) {
        if (TIER_RANK[tier] <= TIER_RANK[floor]) continue;
        const model = byTier[tier];
        if (!model) continue;
        if (model === src.model) clones.add(`same:${base}-${tier}`);
        else make(tier, model);
      }
      make('lead', null);
    }
  };

  return {
    config: async (config) => {
      try {
        config.permission ??= {};
        const task = config.permission.task;
        if (task && typeof task === 'object' && !Array.isArray(task)) {
          config.permission.task = { ...SUITE_TASK, ...task };
        } else if (task === undefined) {
          config.permission.task = { ...SUITE_TASK };
        }
        config.agent ??= {};
        const ladder = buildChooserLadder();
        if (Object.keys(ladder.agents).length) {
          for (const [name, model] of Object.entries(ladder.agents)) {
            const agent = config.agent[name] ??= {};
            agent.model = model;
          }
        }
        byTier = ladder.byTier;
        profile = ladder.profile;
        if (on('CODE_OPS_TIER_ROUTING')) buildClones(config);
        for (const name of ['build', 'plan']) {
          const agent = config.agent[name] ??= {};
          agent.permission ??= {};
          if (agent.permission.task === undefined) agent.permission.task = { ...SUITE_TASK };
        }
      } catch { /* fail open */ }
    },
    'tool.definition': async (input, output) => {
      try {
        const id = String(input?.toolID ?? '').toLowerCase();
        if (id === 'task' || id === 'agent') rewriteTaskDefinition(output, byTier, profile);
      } catch { /* fail open */ }
    },
    'chat.params': async (input, output) => {
      try {
        const row = record(input?.sessionID);
        if (!row) return;
        if (typeof input?.agent === 'string' && input.agent) row.agent = input.agent;
        const model = input?.model;
        if (model?.providerID && model?.id) row.models.add(`${model.providerID}/${model.id}`);
        else if (model?.id) row.models.add(model.id);
        row.lastTs = Date.now();
        if (!on('CODE_OPS_EFFORT_ROUTING') || !suiteAgent(row.agent) || !output || typeof output !== 'object') return;
        const fullId = `${model?.providerID}/${model?.id}`;
        const pick = resolveEffort(row.agent, row.effort);
        const variant = pickVariant(model?.variants ?? live?.variants?.[fullId], pick.level);
        if (variant?.options && typeof variant.options === 'object') {
          output.options ??= {};
          for (const [key, value] of Object.entries(variant.options)) {
            // A level the lead named wins. A default only fills what the agent left unset.
            if (pick.explicit || output.options[key] === undefined) output.options[key] = value;
          }
        }
        if (!row.effortLogged) {
          row.effortLogged = true;
          routingLog({ kind: 'effort', agent: row.agent, model: fullId, requested: row.effortRaw, level: pick.level, variant: variant?.name ?? null });
        }
      } catch { /* fail open */ }
    },
    'chat.message': async (input, output) => {
      try {
        const row = record(input?.sessionID ?? output?.message?.sessionID);
        if (!row) return;
        if (typeof input?.agent === 'string' && input.agent) row.agent = input.agent;
        const pickup = pickupLine(row);
        row.userPrompts += 1;
        row.lastTs = Date.now();
        const text = Array.isArray(output?.parts)
          ? output.parts.map((part) => (part?.type === 'text' ? part.text : '')).join('\n')
          : '';
        if (row.userPrompts > 1 && HANDOFF_RE.test(text)) {
          row.handoffInvoked = true;
          recordAssessment(row);
        }
        if (suiteAgent(row.agent)) {
          const effort = directive(text, 'Effort', EFFORTS);
          if (effort.raw) { row.effort = effort.value; row.effortRaw = effort.raw; }
        }
        if (on('CODE_OPS_LADDER_CARD') && implementerClass(row.agent) && !row.ladderDone) {
          const first = Array.isArray(output?.parts)
            ? output.parts.find((part) => part?.type === 'text' && typeof part.text === 'string')
            : null;
          if (first) {
            first.text = `${LADDER_CARD}\n\n${first.text}`;
            row.ladderDone = true;
          }
        }
        const nudge = nudgeFor(row);
        if (nudge) queueNote(row, nudge);
        // Notes ride on the user turn, at the tail. A note in the system prompt
        // rewrites the prefix and forfeits the cache for the whole context.
        const tail = [...(pickup ? [pickup] : []), ...takeNotes(row)];
        if (!appendToUserText(output, tail)) {
          if (pickup) row.pickupText = pickup;
          for (const note of tail.slice(pickup ? 1 : 0)) queueNote(row, note);
        }
      } catch { /* fail open */ }
    },
    'experimental.chat.system.transform': async (input, output) => {
      try {
        const row = record(input?.sessionID);
        if (!row || !Array.isArray(output?.system)) return;
        // The host rebuilds the system prompt on every model call and keeps
        // nothing a plugin added. The cards go in on every call, byte-identical,
        // so the lead keeps its guidance and the prefix stays cacheable.
        const push = (card) => { if (card && !output.system.includes(card)) output.system.push(card); };
        row.pickupText ??= pickupLine(row);
        push(row.pickupText);
        if (!isSubagent(row)) {
          push(ASSESS_CARD);
          push(TASK_ROUTE);
          if (on('CODE_OPS_TIER_ROUTING') || on('CODE_OPS_EFFORT_ROUTING')) push(routingCard(byTier, profile));
        }
        if (on('CODE_OPS_LADDER_CARD') && implementerClass(row.agent) && (!row.ladderDone || row.ladderViaSystem)) {
          push(LADDER_CARD);
          row.ladderDone = true;
          row.ladderViaSystem = true;
        }
      } catch { /* fail open */ }
    },
    'tool.execute.before': async (input, output) => {
      try {
        const row = record(input?.sessionID);
        if (!row) return;
        const tool = typeof input?.tool === 'string' ? input.tool : '';
        row.toolCalls[tool] = (row.toolCalls[tool] || 0) + 1;
        row.lastTs = Date.now();
        // The model loads a skill through the host's `skill` tool. Loading the
        // handoff skill is the assessment that unlocks the context ceiling.
        if (tool.toLowerCase() === 'skill' && output?.args && typeof output.args === 'object'
          && Object.values(output.args).some((v) => typeof v === 'string' && HANDOFF_RE.test(v))) {
          row.handoffInvoked = true;
          recordAssessment(row);
        }
        if (DISPATCH_TOOLS.has(tool) && on('CODE_OPS_TIER_ROUTING') && output?.args && typeof output.args === 'object') {
          const args = output.args;
          const key = ['subagent_type', 'agent', 'subagentType', 'name'].find((k) => typeof args[k] === 'string' && args[k].trim());
          const type = key ? args[key].trim() : '';
          if (key && suiteAgent(type)) {
            const brief = dispatchPrompt(args);
            const tier = directive(brief, 'Tier', [...TIER_NAMES, 'lead']);
            const effort = directive(brief, 'Effort', EFFORTS);
            const notes = [];
            if (tier.raw && !tier.value) notes.push(`Tier "${tier.raw}" is not light, mid, strong, frontier, or lead; the agent's own binding runs.`);
            if (effort.raw && !effort.value) notes.push(`Effort "${effort.raw}" is not low, medium, high, or xhigh; the default for the role runs.`);
            const routed = routeTier(type, tier.value, clones);
            if (routed.note) notes.push(routed.note);
            let target = routed.agent;
            // A cached binding can outlive the model. The live list decides.
            const bound = agentModels[target];
            const fallback = `${baseAgent(target)}-lead`;
            if (live?.ids && bound && !live.ids.has(bound) && clones.has(fallback)) {
              notes.push(`${bound} is no longer listed by this host; ${baseAgent(target)} inherits your model for this dispatch. Restart OpenCode to rebind.`);
              target = fallback;
            }
            if (target !== type) args[key] = target;
            routingLog({ kind: 'tier', from: type, to: target, tier: tier.raw, effort: effort.raw, model: agentModels[target] ?? 'inherit' });
            if (notes.length) queueNote(row, `Routing: ${notes.join(' ')}`);
          }
        }
        if (!on('CODE_OPS_DISPATCH_GUARD')) return;
        if (!row.parentID && !row.parentChecked && client?.session?.get) {
          row.parentChecked = true;
          try {
            const res = await client.session.get({ path: { id: row.id } });
            const info = res?.data ?? res;
            if (typeof info?.parentID === 'string' && info.parentID) row.parentID = info.parentID;
          } catch { /* fail open */ }
        }
        const budget = roundBudget();
        if (!isSubagent(row) && DISPATCH_TOOLS.has(tool)) {
          const args = output?.args;
          const type = dispatchType(args);
          const leaf = leafName(type);
          const wide = !type || WIDE_TYPES.has(leaf) || WIDE_TYPES.has(type.toLowerCase()) || !suiteAgent(type);
          if (wide) {
            throw new Error(
              `Dispatch guard: ${type || 'an unnamed type'} is not a suite subagent. Dispatch code-ops-suite-implementer, code-ops-suite-explorer, code-ops-suite-reviewer, rigor-tracer, rigor-verifier, privacy-opsec-suite-explorer, privacy-opsec-suite-privacy-reviewer, researcher-claim-checker, or researcher-gatherer.`,
            );
          }
          const ceiling = contextCeiling(profile);
          const band = gateBand(row.contextAtEnd, ceiling);
          if (band >= 1 && assessedBand(row) < band) {
            const approx = Math.round(row.contextAtEnd / 10_000) * 10_000;
            const gate = `Dispatch guard: this session holds about ${approx.toLocaleString('en-US')} tokens, past the ${ceiling.toLocaleString('en-US')}-token context ceiling. Run /code-ops-suite-handoff assess to choose CONTINUE, COMPACT, or HANDOFF before dispatching new work. The assessment unlocks dispatch until the next ${THRESHOLD.toLocaleString('en-US')}-token band.`;
            if (hardStop()) throw new Error(gate);
            queueNote(row, gate);
          }
          const clauses = [];
          const model = dispatchModel(args);
          if (model !== undefined && model !== null && model !== '') {
            clauses.push('A model override replaces the agent\'s declared tier; verify task rationale and tier floor.');
          }
          if (!/round budget/i.test(dispatchPrompt(args))) {
            clauses.push(`No Round budget in the brief; the guard warns at ${budget} rounds, stops at ${budget * STOP_MULTIPLE}.`);
          }
          if (clauses.length) queueNote(row, `Dispatch guard: ${clauses.join(' ')}`);
          return;
        }
        if (!isSubagent(row)) return;
        let used;
        try { used = countRound(counterPath(row.cwd, row.id)); } catch { return; }
        if (hardStop() && used >= budget * STOP_MULTIPLE) {
          throw new Error(
            `Dispatch guard: ${used} tool rounds used, ${STOP_MULTIPLE === 2 ? 'twice' : `${STOP_MULTIPLE} times`} the ${budget}-round budget. Return your report now: what is done with file:line evidence, what remains, the exact next action, and any uncommitted state.`,
          );
        }
        if (used === budget || (used > budget && (used - budget) % WARN_EVERY === 0)) {
          queueNote(
            row,
            `Dispatch guard: ${used} tool rounds used against a ${budget}-round budget. Unless your brief names a larger budget, stop at the next consistent state and checkpoint to your report: what is done with file:line evidence, what remains, and the exact next action. Then return, so the lead continues this unit in a fresh operative.`,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Dispatch guard:')) throw error;
      }
    },
    'tool.execute.after': async (input, output) => {
      try {
        const row = record(input?.sessionID);
        if (!row) return;
        const text = typeof output?.output === 'string' ? output.output : '';
        row.toolResultChars += text.length;
        const tool = typeof input?.tool === 'string' ? input.tool : '';
        queueNote(row, inlineNote(row, tool, text.length));
        // A long run on one prompt never reaches chat.message again, so the
        // context band is checked here too.
        queueNote(row, nudgeFor(row));
        const notes = takeNotes(row);
        if (notes.length && typeof output.output === 'string') {
          output.output = `${output.output}\n${notes.join('\n')}`;
        } else {
          for (const note of notes) queueNote(row, note);
        }
      } catch { /* fail open */ }
    },
    event: async ({ event }) => {
      if (!chooserRefreshed) {
        // Any event means the host finished startup. Not awaited: discovery must
        // never hold up the host.
        chooserRefreshed = true;
        refreshChooserCache(client).then((result) => {
          if (result?.ids) live = { ids: new Set(result.ids), variants: result.variants };
          if (!result?.changed || process.env.CODE_OPS_OPENCODE_MODELS) return;
          return client?.tui?.showToast?.({
            body: { message: 'code-ops: host model list changed. Restart OpenCode to rebind suite agents.', variant: 'info' },
          });
        }).catch(() => { /* fail open */ });
      }
      try {
        const type = event?.type;
        const props = event?.properties ?? {};
        if (type === 'session.created' || type === 'session.updated') {
          rememberParent(props.info);
          return;
        }
        if (type === 'message.updated') {
          const info = props.info;
          if (!info || info.role !== 'assistant') return;
          const row = record(info.sessionID);
          if (!row) return;
          if (info.providerID && info.modelID) row.models.add(`${info.providerID}/${info.modelID}`);
          const key = info.id ?? `at-${info.time?.created ?? row.messages.size}`;
          row.messages.set(key, { tokens: info.tokens, cost: Number(info.cost) > 0 ? Number(info.cost) : 0 });
          const size = contextSize(info.tokens);
          if (typeof size === 'number') row.contextAtEnd = size;
          if (typeof info.time?.created === 'number') {
            row.firstTs = Math.min(row.firstTs, info.time.created);
            row.lastTs = Math.max(row.lastTs, info.time.completed ?? info.time.created);
          }
          return;
        }
        if (type === 'session.idle' || type === 'session.deleted') {
          const id = props.sessionID ?? props.info?.id;
          const row = record(id);
          if (row) {
            mergeChildReceipt(row);
            writeCostRow(row, type === 'session.deleted' ? 'deleted' : 'idle');
            writeReceipt(row, type === 'session.deleted' ? 'deleted' : 'idle');
          }
        }
      } catch { /* fail open */ }
    },
    'experimental.session.compacting': async (input, output) => {
      try {
        if (!Array.isArray(output?.context)) return;
        output.context.push(ASSESS_CARD);
        output.context.push(COMPACT_CHECKPOINT);
        const row = record(input?.sessionID);
        if (row) {
          const pending = pendingHandoff(row.cwd);
          if (pending) output.context.push(`Named durable artifact: ${pending.path} (written ${pending.written}). Point at it; do not restate it.`);
        }
      } catch { /* fail open */ }
    },
  };
};

// WHY one export: OpenCode calls every export of a plugin module as a plugin
// factory. A helper exported beside the factory runs with the plugin input and
// its return value lands in the host's hook list. The proof reaches helpers here.
CodeOpsLifecycle.internals = {
  listChooserModels,
  refreshChooserCache,
  classifyChooserModel,
  pickChooserModel,
  buildChooserLadder,
  baseAgent,
  routeTier,
  resolveEffort,
  pickVariant,
};
