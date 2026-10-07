#!/usr/bin/env node
// Churn: a read-only circling signal over a git range and the run folders (measure set P0-M3,
// baseline in MEASUREMENTS.md "Circling"). It counts rework so a program can see whether its
// fixes keep landing on its own fixes.
//
//   node scripts/churn.mjs [<rev | A..B>] [--since <date>] [--until <date>] [--repo <dir>]
//                          [--runs <dir>] [--json]
//   co churn [<rev | A..B>] [--since <date>] [--until <date>] [--runs <dir>] [--json]
//
// WINDOW. The commits reachable from `<rev>` (default HEAD) whose commit time lies in
// [`--since`, `--until`]. A date-only `--since` starts at 00:00:00 and a date-only `--until` ends at
// 23:59:59, both in local time. With no range and no `--since`, the window is the last 30 days. A
// range such as `A..B` with no dates takes every commit in it. The D-009 baseline is
// `churn 3c1fa907 --since 2026-09-06 --until 2026-10-06`.
//
// MEASURES.
//   re-fix       Share of non-merge commits whose removed lines overlap lines an earlier commit in
//                the window added to the same file within 7 days. Derived outputs never count: they
//                regenerate by tooling, so they churn by design (DERIVED below). The commit
//                denominator is the commits that change at least one non-derived line.
//   reverts      Non-merge commits whose subject starts with Revert, or whose body holds
//                `This reverts commit <sha>`.
//   fix-of-fix   For each merged PR (a merge whose subject starts `Merge pull request #<n>`, with
//                the PR commits being p1..p2), the commits after the first whose subject starts Fix,
//                Restamp, Re-stamp, or Refresh. They split into restamps (mechanical digest stamps)
//                and fixes (review rework). `anyPositionPrs` also counts a PR whose first commit is a
//                fix, since a PR that opens with a review fix has no follow-up commit. A subject that
//                names a review without starting Fix is review feature work, not rework. A merge
//                without a PR subject is skipped and counted.
//   run logs     Under `--runs`, each folder's RUN_LOG.md: `Next:` lines, and those that repeat an
//                earlier line in the same file after lowercasing, dropping digits, and collapsing
//                spaces. Each folder's TASKS.md: ids checked and unchecked. `bothStates` is the
//                upper bound, an id seen both ways anywhere, which counts ids reused across
//                programs. `reopened` is the tighter reading: an id checked in an earlier folder and
//                unchecked in a later folder of the same program (the folder name without its date
//                and `-ho<n>`). Run folders dated after `--until` are skipped. Run folders are
//                gitignored, so these two measures read the live folders, not the commit.
//
// Two `git log` calls in all: one graph pass over the history (subjects, bodies, parents), one patch
// pass over the window with `-U0`. No per-commit or per-PR spawn.
//
// Report-only: it never fails a build. Exit 0 always; 2 = usage error or an unreadable range.
// deferred(100000 commits, load only the window and its merge parents): the graph pass reads the
// whole history of `<rev>`, so PR membership needs no second git call.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git, parseOrDie, usage } from './cli-lib.mjs';

const USAGE = 'usage: churn.mjs [<rev | A..B>] [--since <date>] [--until <date>] [--repo <dir>] [--runs <dir>] [--json]';
const DAY = 86400;
const REFIX_DAYS = 7;
const DEFAULT_WINDOW_DAYS = 30;
// Pathspecs of derived outputs, relative to the top of the repository.
const DERIVED = [
  '.agents', 'opencode-dist',
  'code-ops-docs/98 System', // the atlas and manifest in the code-ops repository; elsewhere it matches nothing
  'plugins/*/scripts/**', '**/CHANGELOG.md', '**/plugin.json', '**/marketplace.json',
].map((spec) => `:(top,exclude,glob)${spec}`);

const REVERT_SUBJECT_RE = /^Revert\b/;
const REVERT_BODY_RE = /This reverts commit [0-9a-f]{7,40}/;
const RESTAMP_RE = /^(Restamp|Re-stamp|Refresh)/;
const FIX_RE = /^Fix/;
const PR_MERGE_RE = /^Merge pull request #(\d+)/;
const TASK_RE = /^\s*- \[([ xX])\]\s+\**([A-Za-z]+-\d+)\b/;

// Each detector below is one line, so the eval can cut it and prove its signal drops.
const isRevert = (subject, body) => REVERT_SUBJECT_RE.test(subject) || REVERT_BODY_RE.test(body);
const isRestamp = (subject) => RESTAMP_RE.test(subject);
const isFixSubject = (subject) => FIX_RE.test(subject);
const overlaps = (earlier, hunk) => earlier.ns <= hunk.os + hunk.oc - 1 && hunk.os <= earlier.ns + earlier.nc - 1;
const nextKey = (line) => line.slice(line.indexOf('Next:') + 5).toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
const isReopened = (states) => states.some((s, i) => !s.checked && states.slice(0, i).some((e) => e.checked && e.folder < s.folder));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};
const percent = (part, whole) => (whole ? Math.round((1000 * part) / whole) / 10 : 0);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (seconds) => { const d = new Date(seconds * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// A date-only value takes the start or the end of its day, in local time.
function epoch(text, endOfDay) {
  const full = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T${endOfDay ? '23:59:59' : '00:00:00'}` : text;
  const ms = Date.parse(full);
  if (Number.isNaN(ms)) usage([`x not a date: ${text}`, USAGE]);
  return Math.floor(ms / 1000);
}

const run = (repo, args) => git(['-c', 'core.quotepath=false', ...args], { cwd: repo, timeout: 300000, maxBuffer: 1 << 29 });

// One pass over the history: every commit with its parents, time, subject, and body.
// `index` grows with age, so a larger index is an older commit.
function readGraph(repo, rev) {
  const out = run(repo, ['log', rev, '--format=%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e', '--']);
  const commits = new Map();
  for (const record of out.split('\x1e')) {
    const text = record.replace(/^\n/, '');
    if (!text) continue;
    const [hash, parents, time, subject, body = ''] = text.split('\x1f');
    commits.set(hash, { hash, parents: parents ? parents.split(' ') : [], time: Number(time), subject, body, index: commits.size });
  }
  return commits;
}

// One pass over the window's patches: the line ranges each non-merge commit removed and added.
function readHunks(repo, rev, since, until) {
  const bounds = [...(since === null ? [] : [`--max-age=${since}`]), ...(until === null ? [] : [`--min-age=${until}`])];
  const out = run(repo, ['log', rev, '--no-merges', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv',
    '-p', '--unified=0', '--format=@@C%H', ...bounds, '--', ':(top)', ...DERIVED]);
  const byCommit = new Map();
  let hunks = null;
  let file = null;
  let inHeader = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@C')) { hunks = []; byCommit.set(line.slice(3).trim(), hunks); file = null; inHeader = false; continue; }
    if (line.startsWith('diff --git ')) { inHeader = true; file = null; continue; }
    if (inHeader) {
      if (line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : line.slice(6).replace(/\t$/, '');
      if (!line.startsWith('@@ ')) continue;
      inHeader = false;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m && hunks && file) hunks.push({ file, os: +m[1], oc: m[2] === undefined ? 1 : +m[2], ns: +m[3], nc: m[4] === undefined ? 1 : +m[4] });
  }
  return byCommit;
}

function refixMeasure(window, hunksByCommit) {
  const history = new Map();
  let eligible = 0;
  let refixed = 0;
  for (const commit of [...window].reverse()) {
    const hunks = hunksByCommit.get(commit.hash) ?? [];
    if (!hunks.length) continue;
    eligible++;
    const recent = commit.time - REFIX_DAYS * DAY;
    if (hunks.some((k) => k.oc > 0 && (history.get(k.file) ?? []).some((p) => p.time >= recent && overlaps(p, k)))) refixed++;
    for (const k of hunks) if (k.nc > 0) history.set(k.file, [...(history.get(k.file) ?? []), { ...k, time: commit.time }]);
  }
  return { eligible, refixed, rate: percent(refixed, eligible) };
}

const reach = (commits, start) => {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const hash = stack.pop();
    if (seen.has(hash) || !commits.has(hash)) continue;
    seen.add(hash);
    stack.push(...commits.get(hash).parents);
  }
  return seen;
};

function fixOfFixMeasure(commits, merges) {
  const rows = [];
  let unmatched = 0;
  for (const merge of merges) {
    const pr = PR_MERGE_RE.exec(merge.subject)?.[1];
    if (!pr || merge.parents.length < 2) { unmatched++; continue; }
    const base = reach(commits, merge.parents[0]);
    const members = [...reach(commits, merge.parents[1])].filter((h) => !base.has(h)).map((h) => commits.get(h))
      .filter((c) => c.parents.length < 2).sort((a, b) => b.index - a.index);
    const later = members.slice(1);
    const restamps = later.filter((c) => isRestamp(c.subject)).length;
    const fixes = later.filter((c) => !isRestamp(c.subject) && isFixSubject(c.subject)).length;
    const reviewAny = members.some((c) => !isRestamp(c.subject) && isFixSubject(c.subject));
    rows.push({ pr: Number(pr), commits: members.length, restamps, fixes, fix: restamps + fixes, reviewAny });
  }
  const counts = rows.map((r) => r.fix);
  const sum = (key) => rows.reduce((total, r) => total + r[key], 0);
  const top = [...rows].sort((a, b) => b.fix - a.fix || b.commits - a.commits).filter((r) => r.fix > 0).slice(0, 3)
    .map((r) => ({ pr: r.pr, fixCommits: r.fix, commits: r.commits }));
  return {
    prs: rows.length, prsWithFollowUps: counts.filter((n) => n > 0).length, commits: sum('fix'), median: median(counts), max: Math.max(0, ...counts),
    restamp: { commits: sum('restamps'), prs: rows.filter((r) => r.restamps > 0).length },
    review: { commits: sum('fixes'), prs: rows.filter((r) => r.fixes > 0).length, anyPositionPrs: rows.filter((r) => r.reviewAny).length },
    unmatchedMerges: unmatched, top,
  };
}

const readText = (file) => (existsSync(file) ? readFileSync(file, 'utf8').replace(/\r/g, '') : '');
const programOf = (folder) => folder.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-ho\d+(?:-\d+)?$/, '');

function runMeasure(root, untilDay) {
  const folders = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    .filter((name) => !/^\d{4}-\d{2}-\d{2}/.test(name) || untilDay === null || name.slice(0, 10) <= untilDay);
  let files = 0;
  let withNext = 0;
  let lines = 0;
  let repeats = 0;
  const ids = new Map();
  for (const folder of folders) {
    const log = join(root, folder, 'RUN_LOG.md');
    if (existsSync(log)) {
      files++;
      const seen = new Set();
      let found = 0;
      for (const line of readText(log).split('\n')) {
        if (!line.includes('Next:')) continue;
        const key = nextKey(line);
        found++;
        if (key !== '' && seen.has(key)) repeats++;
        seen.add(key);
      }
      if (found) { withNext++; lines += found; }
    }
    for (const line of readText(join(root, folder, 'TASKS.md')).split('\n')) {
      const m = TASK_RE.exec(line);
      if (!m) continue;
      const id = m[2].toUpperCase();
      ids.set(id, [...(ids.get(id) ?? []), { folder, program: programOf(folder), checked: m[1] !== ' ' }]);
    }
  }
  const states = [...ids.values()];
  const bothStates = states.filter((s) => s.some((e) => e.checked) && s.some((e) => !e.checked)).length;
  const reopened = states.filter((s) => [...new Set(s.map((e) => e.program))].some((p) => isReopened(s.filter((e) => e.program === p)))).length;
  return { root, folders: folders.length, runLogs: files, withNext, nextLines: lines, repeatedNext: repeats, ids: ids.size, bothStates, reopened };
}

function findRunsRoot(repo) {
  const candidates = [join(repo, '80 Runs'), ...readdirSync(repo).filter((n) => n.endsWith('-docs')).map((n) => join(repo, n, '80 Runs'))];
  return candidates.find((p) => existsSync(p) && statSync(p).isDirectory()) ?? null;
}

function measure({ rev, since, until, repo, runs }) {
  const commits = readGraph(repo, rev);
  const window = [...commits.values()].filter((c) => (since === null || c.time >= since) && (until === null || c.time <= until));
  const merges = window.filter((c) => c.parents.length > 1);
  const plain = window.filter((c) => c.parents.length < 2);
  const reverts = plain.filter((c) => isRevert(c.subject, c.body));
  const result = {
    rev, since: since === null ? null : ymd(since), until: until === null ? null : ymd(until),
    commits: { total: window.length, nonMerge: plain.length, merge: merges.length },
    refix: refixMeasure(window, readHunks(repo, rev, since, until)),
    reverts: { count: reverts.length, of: window.length, commits: reverts.map((c) => c.hash.slice(0, 8)) },
    fixOfFix: fixOfFixMeasure(commits, merges),
    runs: null,
  };
  const root = runs ?? findRunsRoot(repo);
  if (root !== null && existsSync(root)) result.runs = runMeasure(root, until === null ? null : ymd(until));
  return result;
}

function format(r) {
  const f = r.fixOfFix;
  const lines = [
    `churn ${r.rev} ${r.since ?? 'start'}..${r.until ?? 'now'}`,
    `commits ${r.commits.total} (${r.commits.nonMerge} non-merge, ${r.commits.merge} merge), reverts ${r.reverts.count} of ${r.reverts.of}`,
    `re-fix ${r.refix.refixed} of ${r.refix.eligible} commits (${r.refix.rate} percent)`,
    `fix-of-fix ${f.commits} commits in ${f.prsWithFollowUps} of ${f.prs} PRs (median ${f.median}, max ${f.max}), restamp ${f.restamp.commits} in ${f.restamp.prs}, review fix ${f.review.commits} in ${f.review.prs}, review fix in any position ${f.review.anyPositionPrs} PRs, ${f.unmatchedMerges} merges skipped`,
  ];
  for (const t of f.top) lines.push(`  PR ${t.pr}: ${t.fixCommits} of ${t.commits} commits`);
  lines.push(r.runs === null
    ? 'runs none found (pass --runs <dir>)'
    : `runs ${r.runs.nextLines} Next lines in ${r.runs.withNext} of ${r.runs.runLogs} RUN_LOG.md files, repeated ${r.runs.repeatedNext}; ${r.runs.ids} task ids, both states ${r.runs.bothStates}, reopened ${r.runs.reopened}`);
  return lines.join('\n');
}

const { flags, positional } = parseOrDie(process.argv.slice(2), {
  since: { value: true }, until: { value: true }, repo: { value: true }, runs: { value: true }, json: { value: false },
}, USAGE);
if (positional.length > 1) usage([`x unexpected argument: ${positional[1]}`, USAGE]);
if (flags.runs !== undefined && !existsSync(flags.runs)) usage([`x --runs is not a folder: ${flags.runs}`, USAGE]);
const rev = positional[0] ?? 'HEAD';
if (rev.startsWith('-')) usage([`x not a revision: ${rev}`, USAGE]);
const until = flags.until === undefined ? null : epoch(flags.until, true);
const since = flags.since !== undefined ? epoch(flags.since, false)
  : rev.includes('..') ? null : (until ?? Math.floor(Date.now() / 1000)) - DEFAULT_WINDOW_DAYS * DAY;
let result;
try {
  result = measure({ rev, since, until, repo: resolve(flags.repo ?? process.cwd()), runs: flags.runs === undefined ? null : resolve(flags.runs) });
} catch (error) {
  usage([`x churn: cannot read ${rev}: ${error.message.split('\n')[0]}`, USAGE]);
}
console.log(flags.json ? JSON.stringify(result, null, 2) : format(result));
