#!/usr/bin/env node
// Deterministic calibration-metrics extractor + sanitized-note validator for the suite's
// real-scale calibration channel (evals/README.md "Real-scale calibrations run against a
// private mirror repo ... that channel is one-way — only a sanitized calibration note ...
// crosses back into this repo").
//
//   node scripts/calibration-metrics.mjs --artifacts <dir> [--out <file>] [--json <file>]
//   node scripts/calibration-metrics.mjs --validate-note <file>
//
// MODE 1 (--artifacts): reads a run's artifact directory and emits a compact metrics block —
// dispatch-ledger row grammar (scripts/dispatch-ledger.mjs), findings-register Tier/Severity
// fields (scripts/revalidate-register.mjs's schema), refutation-log receipt verdicts, and a
// per-artifact non-blank line count flagged against scan-narration.mjs's length-discipline
// thresholds (CONVENTIONS §12: advisory once a run summary drifts past a page, hard once it's
// clearly a transcript). Each of the three named artifacts is OPTIONAL — its absence is
// reported as "not present", never an error — and a malformed row/item/line is counted and
// reported as "unparseable: N", never silently skipped (the same skip-noting convention the
// referenced scripts use). A present, non-empty artifact that yields zero parsed items gets a
// WARNING line naming it and pointing at docs/techniques/artifact-grammars.md — zero-parse on
// non-empty text means shape drift, not absence (the finding that motivated this warning). The
// ledger's role@model stamp (scripts/dispatch-ledger.mjs) is also parsed into a tier-mix line
// (dispatch count per model; an unstamped role cell counts as "unstamped"), and its positional
// `> phase:` markers into a lead-model-per-phase line plus an advisory when the lead changed
// mid-run. Register entries are detected only at an entry-heading position, so an ID cited in
// evidence prose no longer inflates the finding count; a register that parses to zero entries
// but declares `NO-FINDINGS:` slices reports covered negatives instead of the zero-parse
// warning; and any OTHER .md carrying register-shaped entries — anywhere in the artifact folder,
// which is walked recursively but bounded, so per-slice reports in subdirectories are seen — gets
// a warning that its findings are not counted here (this tool's own report, recognized by its
// --out/--json path or its header line, is not a run artifact and is skipped). Per-entry length
// budgets terminate an entry at the next entry head, a `NO-FINDINGS:` line, or a non-entry
// heading, so a trailing block is not charged to the entry above it.
// This mode always exits 0: it reports a run's shape, it does not gate it.
// `--json <file>` additionally writes the same numbers the prose lines print as one JSON object
// (see MACHINE_SHAPE below) for the calibration graph's ingest side; the prose report is
// byte-identical with and without it, and a failed JSON write is reported on stderr without
// changing the exit code — a report mode must not gate.
//
// MODE 2 (--validate-note): a structural scrub gate for a sanitized calibration note before it
// crosses the one-way channel back into this repo. Fails CLOSED (exit 1) on any hit of: an
// absolute or relative file path (Windows drive-letter, or unix-style with 2+ slash-separated
// segments), a fenced code block, a URL, or an email-like token — each reported with its line
// number and category. The suite's own standard artifact filenames and backticked
// `plugin:skill` slug references are allowlisted first (they are public vocabulary, not a
// leak) so a clean note that legitimately names them never trips the gate. It also fails CLOSED
// on the note's `## Machine block`: a note MISSING that section is rejected (the template now
// requires it — docs/techniques/calibration-protocol.md), and every non-blank line inside it
// must match one of MACHINE_LINE_SHAPES, with a non-matching line reported by line number
// alongside the shapes it could have taken. The scrubs above still run over the whole note,
// the machine block included.
//
// Exit: mode 1 -> always 0 (advisory report). Mode 2 -> 0 clean, 1 on any structural hit
// (fail-closed) unless --report-only, 2 on a usage error (no mode flag, unknown flag, a
// missing --validate-note target).

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

function usage() {
  console.error('usage: calibration-metrics.mjs --artifacts <dir> [--out <file>] [--json <file>]');
  console.error('       calibration-metrics.mjs --validate-note <file> [--report-only]');
  process.exit(2);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -------------------------------------------------------------------------------------
// MODE 1: metrics
// -------------------------------------------------------------------------------------

const LEDGER_ROW_RE = /^\|\s*(D-\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/;
const LEDGER_STATUSES = ['dispatched', 'reported', 'failed', 'redispatched'];
// Phase marker per scripts/dispatch-ledger.mjs `phase`: `> phase: <title> · lead@<model>`.
// Markers are POSITIONAL — every row after one belongs to that phase — so the lead model that
// presided over each stretch of dispatches stays reconstructable after the run.
const PHASE_LINE_RE = /^>\s*phase:\s*(.+?)\s*·\s*lead@(\S+)\s*$/;

// Row grammar per scripts/dispatch-ledger.mjs: | D-NNN | role | brief | expected artifact | status |.
// A row whose shape doesn't match, or whose status isn't one of the four known values, is
// unparseable — counted, never dropped silently.
function summarizeLedger(text) {
  const rows = [];
  const phases = [];
  let phase = null;
  let malformed = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    const pm = PHASE_LINE_RE.exec(line);
    if (pm) { phase = { title: pm[1], lead: pm[2], rows: 0 }; phases.push(phase); continue; }
    if (!line.startsWith('|')) continue;
    if (/^\|\s*id\s*\|/i.test(line)) continue; // header
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) continue; // rule row
    const m = LEDGER_ROW_RE.exec(line);
    if (!m) { malformed++; continue; }
    const [, id, role, brief, artifact, status] = m;
    if (!LEDGER_STATUSES.includes(status)) { malformed++; continue; }
    rows.push({ id, role, brief, artifact, status });
    if (phase) phase.rows++;
  }
  const total = rows.length;
  const byRole = {};
  const byStatus = { dispatched: 0, reported: 0, failed: 0, redispatched: 0 };
  // role@model stamp (dispatch-ledger.mjs): split each row's role cell on its LAST '@' so a
  // role name that itself contains '@' (unlikely, but not impossible) can't misparse the model.
  // An unstamped cell (no '@') is counted as "unstamped" rather than dropped or guessed at.
  const byModel = {};
  for (const r of rows) {
    byRole[r.role] = (byRole[r.role] ?? 0) + 1;
    byStatus[r.status]++;
    const at = r.role.lastIndexOf('@');
    const model = at === -1 ? 'unstamped' : r.role.slice(at + 1).trim() || 'unstamped';
    byModel[model] = (byModel[model] ?? 0) + 1;
  }
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return { total, malformed, byRole, byStatus, byModel, phases, pct };
}

// Findings-register item IDs per revalidate-register.mjs's grammar (e.g. BUG-007, PERF-003,
// and a reviewer-round-lettered FND-A12), ignoring common standards identifiers that
// legitimately appear in prose.
const ID_RE = /\b([A-Z][A-Z0-9]{1,}-[A-Z]?\d{1,6})\b/g;
const ID_IGNORE = new Set(['RFC', 'ISO', 'CVE', 'CWE', 'CAPEC', 'GHSA', 'UTF', 'SHA', 'MD', 'AES', 'RGB', 'HTTP', 'HTTPS', 'IEEE', 'ANSI', 'FIPS', 'NIST', 'PEP', 'ECMA', 'UTC', 'GMT', 'IPV']);
const TIER_RE = /\bTier\s*:\s*([A-Za-z]+)/i;
const SEVERITY_RE = /\bSeverity\s*:\s*([A-Za-z]+)/i;
const KNOWN_TIERS = ['CONFIRMED', 'PROBABLE', 'SPECULATIVE'];

function isItemId(id, after, afterNext) {
  if (ID_IGNORE.has(id.split('-')[0].toUpperCase())) return false;
  if (after === '-' && /\d/.test(afterNext || '')) return false;
  return true;
}

// An entry begins only at an ENTRY-HEADING POSITION: the start of a line, optionally behind
// markdown heading markers or a table row's leading pipe (the two entry forms in
// docs/techniques/artifact-grammars.md §(b)). An ID inside evidence prose ("duplicate of
// BUG-003") or a domain tag in body text (INC-2024) is a reference, not a boundary — the
// unanchored scan counted 13 of a real target's historical incident tags as findings. Composed
// from ID_RE's own source so the ID shape cannot drift between the anchored and mid-line scans.
const ENTRY_ID_RE = new RegExp('^[ \\t]*(?:#{1,6}[ \\t]+|\\|[ \\t]*)?' + ID_RE.source);

// The item ID this line opens an entry (or a refutation receipt) with, or null when the line
// carries none at that position. One truth for "does an ID sit at entry-heading position".
function entryIdAt(line) {
  const m = ENTRY_ID_RE.exec(line);
  if (!m) return null;
  return isItemId(m[1], line[m[0].length], line[m[0].length + 1]) ? { id: m[1], prefixLength: m[0].length - m[1].length } : null;
}

// Returns [{ id, index, line }] — absolute character offset and 0-based line of each entry head.
function findEntryIds(text) {
  const out = [];
  let offset = 0;
  text.split('\n').forEach((raw, lineNo) => {
    const line = raw.replace(/\r$/, '');
    const hit = entryIdAt(line);
    if (hit) out.push({ id: hit.id, index: offset + hit.prefixLength, line: lineNo });
    offset += raw.length + 1;
  });
  return out;
}

// A covered negative: a slice a run genuinely swept and cleared, declared at line start as
// `NO-FINDINGS: <slice label> — <why/evidence>`. Zero entries plus >=1 of these is a
// well-formed zero-finding result, not the shape drift the zero-parse warning exists for.
const NO_FINDINGS_RE = /^[ \t]*NO-FINDINGS:\s*\S/;

const countCoveredNegatives = (text) => text.split('\n').filter((l) => NO_FINDINGS_RE.test(l.replace(/\r$/, ''))).length;

// An entry runs to the last line that BELONGS to it — it is terminated by the next entry
// heading, by a covered-negative `NO-FINDINGS:` line, or by a non-entry markdown heading that
// opens a new section (docs/techniques/artifact-grammars.md §(b) "Where an entry ends"). Without
// a terminator, a register's trailing covered-negative block was attributed to its final entry
// and reliably tripped that entry's hard cap on a register whose entries were all tight.
const SECTION_HEADING_RE = /^[ \t]*#{1,6}[ \t]+/;
const isEntryTerminator = (line) => NO_FINDINGS_RE.test(line) || (SECTION_HEADING_RE.test(line) && !entryIdAt(line));

function entryEndLine(fileLines, startLine, nextEntryLine) {
  const limit = nextEntryLine ?? fileLines.length;
  for (let i = startLine + 1; i < limit; i++) {
    if (isEntryTerminator(fileLines[i].replace(/\r$/, ''))) return i;
  }
  return limit;
}

// Per-item Tier (CONFIRMED/PROBABLE/SPECULATIVE) and Severity fields, per revalidate-register's
// schema (CONVENTIONS §7). An item with no Tier field, or a Tier value outside the known set,
// is unparseable — counted, never dropped silently.
function summarizeRegister(text) {
  const ids = findEntryIds(text);
  let malformed = 0;
  const byTier = { CONFIRMED: 0, PROBABLE: 0, SPECULATIVE: 0 };
  const bySeverity = {};
  for (let i = 0; i < ids.length; i++) {
    const block = text.slice(ids[i].index, ids[i + 1]?.index ?? text.length);
    const tm = block.match(TIER_RE);
    const tier = tm && tm[1].toUpperCase();
    if (!tier || !KNOWN_TIERS.includes(tier)) { malformed++; continue; }
    byTier[tier]++;
    const sm = block.match(SEVERITY_RE);
    if (sm) {
      const sev = sm[1].toUpperCase();
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }
  }
  const total = ids.length - malformed;
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return { totalItems: ids.length, malformed, byTier, bySeverity, total, coveredNegatives: countCoveredNegatives(text), pct };
}

// Refutation-log receipt lines per revalidate-register.mjs's comment grammar: one verdict per
// line, keyed by the finding's own ID, carrying a SURVIVED|REFUTED token. A receipt is keyed by
// an ID at RECEIPT POSITION — the start of the line — mirroring the entry-heading position
// registers use (docs/techniques/artifact-grammars.md §(b)/§(c)). An ID cited mid-line in
// explanatory prose ("read BUG-001 as a duplicate of BUG-003") is a citation, not a receipt:
// matched mid-line, such a line was counted unparseable, or — when the prose happened to carry a
// verdict word — as a second verdict for a finding already receipted. A line whose leading ID
// carries no recognized verdict token is still unparseable: counted, never dropped silently.
const VERDICT_RE = /\b(SURVIVED|REFUTED)\b/;

function summarizeRefutation(text) {
  let total = 0, survived = 0, refuted = 0, malformed = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (!entryIdAt(line)) continue; // not a receipt row
    const vm = line.match(VERDICT_RE);
    if (!vm) { malformed++; continue; }
    total++;
    if (vm[1] === 'SURVIVED') survived++; else refuted++;
  }
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return { total, survived, refuted, malformed, pct };
}

// scan-narration.mjs's length-discipline bounds (CONVENTIONS §12): advisory once a run
// artifact drifts past roughly a page, hard once it reads as a transcript rather than a
// synthesis.
const ADVISORY_LINES = 60;
const HARD_LINES = 120;
// Register-shaped artifacts (basename matches /register/i) are checked PER ENTRY instead, on
// scan-narration.mjs's four bounds: the flat cap is right for run summaries but wrong for a
// register, where a 49-finding backlog is legitimate and one 30-line rambling entry is not.
const REGISTER_ENTRY_ADVISORY_LINES = 10;
const REGISTER_ENTRY_HARD_LINES = 20;
const REGISTER_PREAMBLE_ADVISORY_LINES = 15;
const REGISTER_PREAMBLE_HARD_LINES = 30;
const isRegisterArtifact = (label) => /register/i.test(label);

// The three artifacts this mode parses metrics from; any OTHER .md carrying register-shaped
// entries is a themed sibling report whose findings never reach the metrics (see the sweep).
const METRIC_ARTIFACTS = new Set(['DISPATCH_LEDGER.MD', 'FINDINGS_REGISTER.MD', 'REFUTATION_LOG.MD']);

// The artifact folder is walked RECURSIVELY: a run that writes per-slice reports into
// subdirectories was previously scanned top-level only, so those reports' entry-shaped findings
// stayed invisible to the sibling-report warning and to every register consumer. The walk is
// bounded — a depth cap plus the usual non-artifact directories — so it stays proportional to a
// run's artifact folder even if one is nested inside a working tree.
const WALK_MAX_DEPTH = 4;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);
const isSkippedDir = (name) => name.startsWith('.') || SKIPPED_DIRS.has(name);

// Returns forward-slash relative paths, sorted, so a report reads the same on every platform.
function listMarkdown(dir, prefix = '', depth = 0) {
  let names = [];
  try { names = readdirSync(dir).sort(); }
  catch { return []; }
  const out = [];
  for (const name of names) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (depth >= WALK_MAX_DEPTH || isSkippedDir(name)) continue;
      out.push(...listMarkdown(full, rel, depth + 1));
    } else if (st.isFile() && name.toLowerCase().endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

// This tool's own report is not a run artifact: the per-entry length lines it emits
// ("    FIND-004: 26 non-blank line(s)") sit at entry position, so a report left in the artifact
// folder was read back as a register and warned about as findings written outside one. It is
// recognized by its `--out`/`--json` path and, for a report left by an earlier run under any
// name, by the header line it always opens with.
const SELF_REPORT_HEAD_RE = /^# calibration-metrics — /;

const countNonBlank = (lines) => lines.filter((l) => l.replace(/\r$/, '').trim() !== '').length;

function nonBlankCount(text) {
  return countNonBlank(text.split('\n'));
}

function headShaFor(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString().trim();
  } catch {
    return 'unknown'; // fail-open: not a git tree, or git unavailable
  }
}

// MACHINE_SHAPE (--json): the prose report's own numbers, nothing derived and nothing new.
//   { ledger:      { total, malformed, byRole, byStatus, byModel, phases: [{title, lead, rows}] } | null,
//     findings:    { totalItems, malformed, total, byTier, bySeverity, coveredNegatives }        | null,
//     refutations: { total, survived, refuted, malformed }                                       | null,
//     lineBudget:  [{ file, nonBlank, entries: N|null, flags: [...] }] }
// An artifact that is absent (or unreadable) is null — the same "not present" the prose reports,
// never a zero that would read as a measured value. `entries` is null for a file scored on the
// flat cap and the entry count for one scored per entry; `flags` carries the length flags the
// prose emits for that file ('HARD'/'advisory', or '<id> HARD'/'preamble advisory' per entry).
function runMetrics(dir, outPath, jsonPath) {
  const lines = [];
  const p = (s = '') => lines.push(s);
  const machine = { ledger: null, findings: null, refutations: null, lineBudget: [] };

  const readIfPresent = (name) => {
    const full = join(dir, name);
    if (!existsSync(full)) return null;
    try { return readFileSync(full, 'utf8'); }
    catch (e) { console.error(`x cannot read ${full}: ${e.message}`); return null; }
  };

  // A present, non-empty artifact that yields zero parsed items is a shape-drift signal, not
  // an absence signal (real-scale calibration runs found the extractor parsing zero items from
  // two straight non-empty artifacts because their shape had drifted) — say so instead of
  // reporting a silent "0" that reads as "nothing here". Never gates: this mode always exits 0.
  const warnZeroParse = (name, text) => {
    if (text.trim() === '') return; // genuinely empty is not shape drift
    p(`  !! WARNING: ${name} is present and non-empty but yielded 0 parsed items — check its`
      + ' shape against docs/techniques/artifact-grammars.md before assuming there is nothing to report.');
  };

  p(`# calibration-metrics — ${dir}`);

  // ---- dispatches --------------------------------------------------------------
  p('\n## Dispatches (DISPATCH_LEDGER.md)');
  const ledgerText = readIfPresent('DISPATCH_LEDGER.md');
  if (ledgerText === null) {
    p('  not present');
  } else {
    const s = summarizeLedger(ledgerText);
    machine.ledger = {
      total: s.total, malformed: s.malformed, byRole: s.byRole, byStatus: s.byStatus, byModel: s.byModel,
      phases: s.phases.map((ph) => ({ title: ph.title, lead: ph.lead, rows: ph.rows })),
    };
    p(`  ${s.total} dispatch(es), unparseable: ${s.malformed}`);
    if (s.total === 0) warnZeroParse('DISPATCH_LEDGER.md', ledgerText);
    const roleList = Object.entries(s.byRole).map(([r, n]) => `${r} ${n}`).join(', ') || '(none)';
    p(`  by role: ${roleList}`);
    const statusList = LEDGER_STATUSES.map((st) => `${st} ${s.byStatus[st]} (${s.pct(s.byStatus[st])}%)`).join(', ');
    p(`  by status: ${statusList}`);
    p(`  dangling rate: ${s.pct(s.byStatus.dispatched)}% (${s.byStatus.dispatched}/${s.total})`);
    p(`  failed rate: ${s.pct(s.byStatus.failed)}% (${s.byStatus.failed}/${s.total})`);
    p(`  redispatched rate: ${s.pct(s.byStatus.redispatched)}% (${s.byStatus.redispatched}/${s.total})`);
    const modelList = Object.entries(s.byModel).map(([m, n]) => `${m} ${n}`).join(', ') || '(none)';
    p(`  tier mix: ${modelList}`);
    // Phase markers are optional: a ledger without them reports nothing extra here.
    if (s.phases.length) {
      p(`  lead model by phase: ${s.phases.map((ph) => `${ph.title}=${ph.lead}`).join(', ')}`);
      p(`  dispatches by phase: ${s.phases.map((ph) => `${ph.title} ${ph.rows}`).join(', ')}`);
      const leads = [...new Set(s.phases.map((ph) => ph.lead))];
      if (leads.length > 1)
        p(`  .. advisory: lead model changed mid-run (${leads.join(' -> ')}) — dispatches before and`
          + ' after the change were presided over by different tiers; check the later phases were not led a tier low.');
    }
  }

  // ---- findings -----------------------------------------------------------------
  p('\n## Findings (FINDINGS_REGISTER.md)');
  const registerText = readIfPresent('FINDINGS_REGISTER.md');
  if (registerText === null) {
    p('  not present');
  } else {
    const s = summarizeRegister(registerText);
    machine.findings = {
      totalItems: s.totalItems, malformed: s.malformed, total: s.total,
      byTier: s.byTier, bySeverity: s.bySeverity, coveredNegatives: s.coveredNegatives,
    };
    p(`  ${s.total} finding(s), unparseable: ${s.malformed}`);
    p(`  covered negatives: ${s.coveredNegatives}`);
    // A register that parses to zero entries but declares covered negatives is a swept-and-clear
    // slice, not shape drift — say which it is instead of firing the zero-parse warning.
    if (s.total === 0 && s.coveredNegatives > 0)
      p(`  covered-negative register: ${s.coveredNegatives} slice(s) declared clear with zero findings —`
        + ' a well-formed zero-finding result, not shape drift.');
    else if (s.total === 0) warnZeroParse('FINDINGS_REGISTER.md', registerText);
    const tierList = KNOWN_TIERS.map((t) => `${t} ${s.byTier[t]} (${s.pct(s.byTier[t])}%)`).join(', ');
    p(`  by tier: ${tierList}`);
    p(`  CONFIRMED ratio: ${s.pct(s.byTier.CONFIRMED)}%`);
    const sevEntries = Object.entries(s.bySeverity);
    p(`  by severity: ${sevEntries.length ? sevEntries.map(([sv, n]) => `${sv} ${n}`).join(', ') : '(none labeled)'}`);
  }

  // ---- refutations ----------------------------------------------------------------
  p('\n## Refutations (REFUTATION_LOG.md)');
  const refutationText = readIfPresent('REFUTATION_LOG.md');
  if (refutationText === null) {
    p('  not present');
  } else {
    const s = summarizeRefutation(refutationText);
    machine.refutations = { total: s.total, survived: s.survived, refuted: s.refuted, malformed: s.malformed };
    p(`  ${s.total} receipt(s), unparseable: ${s.malformed}`);
    if (s.total === 0) warnZeroParse('REFUTATION_LOG.md', refutationText);
    p(`  SURVIVED ${s.survived} (${s.pct(s.survived)}%), REFUTED ${s.refuted} (${s.pct(s.refuted)}%)`);
    p(`  survival rate: ${s.pct(s.survived)}%`);
  }

  // ---- per-artifact line counts (CONVENTIONS §12 length discipline) ------------
  p(`\n## Artifact line counts (advisory ${ADVISORY_LINES} / hard ${HARD_LINES} non-blank lines, CONVENTIONS §12;`
    + ` register-shaped files: per-entry ${REGISTER_ENTRY_ADVISORY_LINES}/${REGISTER_ENTRY_HARD_LINES}, preamble ${REGISTER_PREAMBLE_ADVISORY_LINES}/${REGISTER_PREAMBLE_HARD_LINES})`);
  const selfReportPaths = new Set([outPath, jsonPath].filter(Boolean).map((pth) => resolve(pth)));
  const mdFiles = existsSync(dir) ? listMarkdown(dir) : [];
  if (mdFiles.length === 0) {
    p('  (no .md artifacts found)');
  } else {
    for (const f of mdFiles) {
      let text;
      try { text = readFileSync(join(dir, f), 'utf8'); }
      catch (e) { p(`  ${f}: unreadable (${e.message})`); machine.lineBudget.push({ file: f, nonBlank: null, entries: null, flags: ['unreadable'] }); continue; }
      if (selfReportPaths.has(resolve(join(dir, f))) || SELF_REPORT_HEAD_RE.test(text.split('\n')[0] ?? '')) {
        p(`  ${f}: skipped — this tool's own report, not a run artifact`);
        continue;
      }
      const fileLines = text.split('\n');
      const entries = findEntryIds(text);
      const budget = { file: f, nonBlank: countNonBlank(fileLines), entries: null, flags: [] };
      machine.lineBudget.push(budget);
      if (isRegisterArtifact(f) && entries.length) {
        budget.entries = entries.length;
        // Per-entry budget: a register with many tight entries passes; one bloated entry is
        // named. A /register/i file with zero parsed entries falls through to the flat cap.
        p(`  ${f}: ${countNonBlank(fileLines)} non-blank line(s) across ${entries.length} entry(ies)`
          + ` (per-entry advisory ${REGISTER_ENTRY_ADVISORY_LINES} / hard ${REGISTER_ENTRY_HARD_LINES})`);
        const preamble = countNonBlank(fileLines.slice(0, entries[0].line));
        if (preamble > REGISTER_PREAMBLE_HARD_LINES) { p(`    preamble: ${preamble} non-blank line(s)  !! HARD`); budget.flags.push('preamble HARD'); }
        else if (preamble > REGISTER_PREAMBLE_ADVISORY_LINES) { p(`    preamble: ${preamble} non-blank line(s)  .. advisory`); budget.flags.push('preamble advisory'); }
        for (let i = 0; i < entries.length; i++) {
          const n = countNonBlank(fileLines.slice(entries[i].line, entryEndLine(fileLines, entries[i].line, entries[i + 1]?.line)));
          if (n > REGISTER_ENTRY_HARD_LINES) { p(`    ${entries[i].id}: ${n} non-blank line(s)  !! HARD`); budget.flags.push(`${entries[i].id} HARD`); }
          else if (n > REGISTER_ENTRY_ADVISORY_LINES) { p(`    ${entries[i].id}: ${n} non-blank line(s)  .. advisory`); budget.flags.push(`${entries[i].id} advisory`); }
        }
      } else {
        const n = countNonBlank(fileLines);
        const flag = n > HARD_LINES ? '  !! HARD' : n > ADVISORY_LINES ? '  .. advisory' : '';
        if (flag) budget.flags.push(n > HARD_LINES ? 'HARD' : 'advisory');
        p(`  ${f}: ${n} non-blank line(s)${flag}`);
      }
      // A themed sibling report (SECURITY_REPORT.md, PERF_NOTES.md, ...) that carries entries of
      // its own is findings written outside the register: every metric above misses them.
      if (!METRIC_ARTIFACTS.has(f.toUpperCase()) && entries.length)
        p(`  !! WARNING: ${f} carries ${entries.length} register-shaped entry(ies) that are NOT counted in`
          + ' the metrics above — findings must live in FINDINGS_REGISTER.md (docs/techniques/artifact-grammars.md).');
    }
  }

  // ---- footer ---------------------------------------------------------------------
  p(`\n## Footer\n  HEAD: ${headShaFor(process.cwd())}`);

  const report = lines.join('\n') + '\n';
  console.log(report);
  if (outPath) {
    try { writeFileSync(outPath, report); }
    catch (e) { console.error(`x cannot write --out ${outPath}: ${e.message}`); }
  }
  // A failed --json write is reported and survived, exactly like a failed --out write: this
  // mode reports a run's shape and must never gate it.
  if (jsonPath) {
    try { writeFileSync(jsonPath, JSON.stringify(machine, null, 2) + '\n'); }
    catch (e) { console.error(`x cannot write --json ${jsonPath}: ${e.message}`); }
  }
  process.exit(0); // this mode always reports; it never gates
}

// -------------------------------------------------------------------------------------
// MODE 2: sanitized-note validation
// -------------------------------------------------------------------------------------

// Public vocabulary, not a leak: the suite's own standard artifact filenames (CONVENTIONS
// §12 "Standard filenames" plus the calibration-channel additions this eval introduces).
const STANDARD_FILENAMES = [
  'DISPATCH_LEDGER.md', 'FINDINGS_REGISTER.md', 'EXECUTIVE_SUMMARY.md', 'REFUTATION_LOG.md',
  'RUN_RECEIPTS.md', 'REPO_MAP.md', 'IMPORT_GRAPH.md', 'CALIBRATION_NOTE.md', 'FLOOR_TABLE.md',
  'CALIBRATION_TABLE.md',
];

// Strip allowlisted tokens BEFORE running any structural detector, so neither the exact
// detector shape nor match order can let an allowlisted mention leak through as a false
// positive — the allowlist is a pre-filter, not a post-hoc exemption.
function stripAllowlisted(line) {
  let out = line;
  for (const name of STANDARD_FILENAMES) {
    out = out.replace(new RegExp('`?' + escapeRe(name) + '`?', 'g'), ' ');
  }
  // A backticked `plugin:skill` slug (lowercase, hyphenated) is public vocabulary too.
  out = out.replace(/`[a-z][a-z0-9-]*:[a-z][a-z0-9-]*`/gi, ' ');
  // The Machine block's severity-mix token is a fixed literal plus five counts. It carries no
  // leak surface, but its slashes read as a unix-style path to the detector below, so it is
  // pre-filtered like the other public vocabulary. Anchored to the literal `c/h/m/l/n as` head
  // and digits only — nothing else in a note can hide behind it.
  out = out.replace(/\bc\/h\/m\/l\/n as \d+\/\d+\/\d+\/\d+\/\d+\b/g, ' ');
  return out;
}

// ---- Machine block (docs/techniques/calibration-protocol.md note template) -----------
// The block is the machine-readable half of a sanitized note: counts, kebab slugs and enum
// words only, line-based, no fences and no paths. One regex per template line, in template
// order, each paired with the shape text a violation is reported against.
const MACHINE_HEADING_RE = /^##\s+Machine block\s*$/i;
const ANY_HEADING_RE = /^#{1,6}\s+/;
const MACHINE_LINE_SHAPES = [
  // run-date: YYYY-MM-DD
  { shape: 'run-date: YYYY-MM-DD', re: /^run-date: \d{4}-\d{2}-\d{2}$/ },
  // suite: <plugin>@<semver> [, more]
  { shape: 'suite: <plugin>@<semver>[, <plugin>@<semver> ...]', re: /^suite: [a-z][a-z0-9-]*@\d+\.\d+\.\d+(?:, [a-z][a-z0-9-]*@\d+\.\d+\.\d+)*$/ },
  // target-class: <kebab-slug>; control: yes|no
  { shape: 'target-class: <kebab-slug>; control: yes|no', re: /^target-class: [a-z0-9]+(?:-[a-z0-9]+)*; control: (?:yes|no)$/ },
  // track: assess-only|implement
  { shape: 'track: assess-only|implement', re: /^track: (?:assess-only|implement)$/ },
  // findings: N; confirmed: N
  { shape: 'findings: N; confirmed: N', re: /^findings: \d+; confirmed: \d+$/ },
  // paneled: N of M eligible; survived: N; repro-exempt: N   (or: paneled: N of unknown eligible;
  // ... — a run that never counted its eligible panel says so; the `unknown` literal is the only
  // non-numeric value, so a fail-closed gate has an honest escape without accepting arbitrary
  // prose, and the ingest side maps it to panelEligible null rather than a measured zero)
  { shape: 'paneled: N of M eligible; survived: N; repro-exempt: N (or: paneled: N of unknown eligible; ...)', re: /^paneled: \d+ of (?:\d+|unknown) eligible; survived: \d+; repro-exempt: \d+$/ },
  // severity: c/h/m/l/n as N/N/N/N/N (or: unknown)
  { shape: 'severity: c/h/m/l/n as N/N/N/N/N (or: severity: unknown)', re: /^severity: (?:c\/h\/m\/l\/n as \d+\/\d+\/\d+\/\d+\/\d+|unknown)$/ },
  // tokens: N operative; dispatches: N   (or: tokens: unknown operative; dispatches: N — a run
  // with no operative token count says so; the `unknown` literal is the only non-numeric value,
  // so a fail-closed gate has an honest escape without accepting arbitrary prose)
  { shape: 'tokens: N operative; dispatches: N (or: tokens: unknown operative; dispatches: N)', re: /^tokens: (?:\d+|unknown) operative; dispatches: \d+$/ },
  // orchestration: dangling N; failed N; redispatched N
  { shape: 'orchestration: dangling N; failed N; redispatched N', re: /^orchestration: dangling \d+; failed \d+; redispatched \d+$/ },
  // standardization: enforcements N; traceless clean|dirty
  { shape: 'standardization: enforcements N; traceless clean|dirty', re: /^standardization: enforcements \d+; traceless (?:clean|dirty)$/ },
  // coverage: covered-negatives N; slices swept N of M (or: unknown)
  { shape: 'coverage: covered-negatives N; slices swept N of M (or: coverage: unknown)', re: /^coverage: (?:covered-negatives \d+; slices swept \d+ of \d+|unknown)$/ },
  // atlas: sections N; fresh N; refreshed N; falsified N — the target's atlas as the run
  // consumed it. OPTIONAL by design: runs recorded before the atlas leg existed carry no such
  // line, so its ABSENCE is never a hit; a line that is present must be four counts.
  { shape: 'atlas: sections N; fresh N; refreshed N; falsified N', re: /^atlas: sections \d+; fresh \d+; refreshed \d+; falsified \d+$/ },
  // lesson: recur L-NNN
  { shape: 'lesson: recur L-NNN', re: /^lesson: recur L-\d{3}$/ },
  // lesson: new <instrument|suite|protocol> — <statement>   (id assigned at ingest)
  { shape: 'lesson: new instrument|suite|protocol — <statement>', re: /^lesson: new (?:instrument|suite|protocol) — \S.*$/ },
];
const MACHINE_SHAPE_LIST = MACHINE_LINE_SHAPES.map((s) => s.shape).join(' | ');

// Fails CLOSED on a note with no Machine block at all — the template requires it, so its
// absence means the note predates the current template (or dropped the block), and ingesting
// it would silently produce a run doc with no numbers. Returns the same {line, cat, snippet}
// hits the structural scrubs produce, so both classes print and gate identically.
function validateMachineBlock(text) {
  const hits = [];
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => MACHINE_HEADING_RE.test(l.trim()));
  if (start === -1) {
    hits.push({
      line: 1, cat: 'MACHINE-BLOCK',
      snippet: 'no "## Machine block" section — the sanitized-note template requires one'
        + ' (docs/techniques/calibration-protocol.md); a note without it cannot be ingested.',
    });
    return hits;
  }
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (ANY_HEADING_RE.test(line)) break; // block ends at the next heading
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (MACHINE_LINE_SHAPES.some((s) => s.re.test(trimmed))) continue;
    hits.push({
      line: i + 1, cat: 'MACHINE-LINE',
      snippet: `${trimmed.slice(0, 90)}  <- matches no Machine-block shape; expected one of: ${MACHINE_SHAPE_LIST}`,
    });
  }
  return hits;
}

const URL_RE_G = /https?:\/\/[^\s`'")]+/gi;
const CODE_FENCE_RE = /```/;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/;
const WINDOWS_PATH_RE = /\b[A-Za-z]:[\\/][^\s`'")]*/;
// Unix-style path: 2+ slash-separated segments (a bare filename like `DISPATCH_LEDGER.md` has
// no slash and never matches this on its own).
const UNIX_PATH_RE = /(?:\.{1,2}\/)?[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*/;

function validateNote(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const lineNo = i + 1;

    if (CODE_FENCE_RE.test(line)) hits.push({ line: lineNo, cat: 'CODE-FENCE', snippet: line.trim().slice(0, 90) });

    const urlMatches = [...line.matchAll(URL_RE_G)];
    if (urlMatches.length) hits.push({ line: lineNo, cat: 'URL', snippet: line.trim().slice(0, 90) });
    const withoutUrls = line.replace(URL_RE_G, ' '); // avoid double-flagging a URL's own slashes as PATH

    if (EMAIL_RE.test(withoutUrls)) hits.push({ line: lineNo, cat: 'EMAIL', snippet: line.trim().slice(0, 90) });

    const sanitized = stripAllowlisted(withoutUrls);
    if (WINDOWS_PATH_RE.test(sanitized)) hits.push({ line: lineNo, cat: 'PATH-WINDOWS', snippet: line.trim().slice(0, 90) });
    else if (UNIX_PATH_RE.test(sanitized)) hits.push({ line: lineNo, cat: 'PATH-UNIX', snippet: line.trim().slice(0, 90) });
  });
  return hits;
}

function runValidateNote(filePath, reportOnly) {
  if (!existsSync(filePath)) { console.error(`x not found: ${filePath}`); process.exit(2); }
  let text;
  try { text = readFileSync(filePath, 'utf8'); }
  catch (e) { console.error(`x cannot read ${filePath}: ${e.message}`); process.exit(2); }

  const hits = validateNote(text);
  const machineHits = validateMachineBlock(text);
  const clean = hits.length === 0 && machineHits.length === 0;
  console.log(`# calibration-note validation — ${filePath}${clean ? '  — clean' : ''}`);
  for (const h of [...hits, ...machineHits]) console.log(`  !! ${h.cat.padEnd(13)} L${h.line}  ${h.snippet}`);
  console.log(`\n${hits.length} structural hit(s).`);
  console.log(`${machineHits.length} machine-block hit(s).`);
  if (!clean && !reportOnly) {
    console.error('Sanitized-note validation failed (fail-closed) — remove paths/fences/URLs/emails and fix the Machine block before this note crosses the one-way calibration channel.');
    process.exit(1);
  }
}

// -------------------------------------------------------------------------------------
// dispatch
// -------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const rest = argv.filter((a) => a !== '--report-only');

if (rest[0] === '--artifacts') {
  const dirArg = rest[1];
  if (dirArg === undefined || dirArg.trim() === '' || dirArg.startsWith('--')) { console.error('x --artifacts needs a directory'); usage(); }
  // Optional emit flags, each a <flag> <path> pair, in either order — same shape as the
  // original single `--out <file>` tail, so an unknown or value-less flag still exits 2.
  let outPath = null;
  let jsonPath = null;
  for (let i = 2; i < rest.length; i += 2) {
    const flag = rest[i];
    if (flag !== '--out' && flag !== '--json') { console.error(`x unknown argument: ${flag}`); usage(); }
    const val = rest[i + 1];
    if (val === undefined || val.trim() === '' || val.startsWith('--')) { console.error(`x ${flag} needs a path`); usage(); }
    if (flag === '--out') outPath = val; else jsonPath = val;
  }
  runMetrics(resolve(dirArg), outPath ? resolve(outPath) : null, jsonPath ? resolve(jsonPath) : null);
} else if (rest[0] === '--validate-note') {
  const fileArg = rest[1];
  if (fileArg === undefined || fileArg.trim() === '' || fileArg.startsWith('--')) { console.error('x --validate-note needs a file'); usage(); }
  if (rest.length > 2) { console.error(`x unknown argument: ${rest[2]}`); usage(); }
  runValidateNote(resolve(fileArg), reportOnly);
} else {
  usage();
}
