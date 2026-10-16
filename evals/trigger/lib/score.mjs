// Scoring: one trigger table for the query set's skill.

const bare = (id) => String(id).split(':').pop();

/** True when an observed skill id names the expected one. A bare id matches by skill name. */
export function sameSkill(observed, expected) {
  if (!observed || !expected) return false;
  if (observed === expected) return true;
  return !observed.includes(':') && observed === bare(expected);
}

/**
 * results: [{ query, expect, stratum, runs: [{ skill|null, costUsd|null }] }]
 * Returns { skill, positiveRuns, hits, hitRate, negativeRuns, falseFires, falseFireRate,
 *           falseFiresBySibling, byStratum, runs, totalCostUsd }.
 */
export function scoreResults(skill, results) {
  const t = { skill, positiveRuns: 0, hits: 0, hitRate: null, negativeRuns: 0, falseFires: 0, falseFireRate: null,
    falseFiresBySibling: {}, byStratum: {}, runs: 0, totalCostUsd: null };
  for (const r of results) {
    const positive = r.expect === skill;
    const s = (t.byStratum[r.stratum] ??= { runs: 0, correct: 0 });
    for (const run of r.runs) {
      t.runs += 1;
      s.runs += 1;
      if (typeof run.costUsd === 'number') t.totalCostUsd = (t.totalCostUsd ?? 0) + run.costUsd;
      const correct = r.expect === 'none' ? !run.skill : sameSkill(run.skill, r.expect);
      if (correct) s.correct += 1;
      if (positive) {
        t.positiveRuns += 1;
        if (sameSkill(run.skill, skill)) t.hits += 1;
      } else {
        t.negativeRuns += 1;
        if (run.skill && !sameSkill(run.skill, r.expect)) {
          t.falseFires += 1;
          t.falseFiresBySibling[run.skill] = (t.falseFiresBySibling[run.skill] ?? 0) + 1;
        }
      }
    }
  }
  if (t.positiveRuns) t.hitRate = t.hits / t.positiveRuns;
  if (t.negativeRuns) t.falseFireRate = t.falseFires / t.negativeRuns;
  return t;
}

const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);

/** Render the table as Markdown. */
export function renderMarkdown(table, meta = {}) {
  const sib = Object.entries(table.falseFiresBySibling).map(([k, v]) => `${k} x${v}`).join(', ') || 'none';
  const lines = [
    `# Trigger table: ${table.skill}`, '',
    ...(meta.split ? [`Split: ${meta.split}; seed ${meta.seed}; runs per query ${meta.runsPerQuery}; routing card ${meta.routingCard ?? 'off'}.`, ''] : []),
    '| Skill | Hit rate | Hits / positive runs | False fires | False fires by sibling | Runs | Total cost (USD) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| ${table.skill} | ${pct(table.hitRate)} | ${table.hits} / ${table.positiveRuns} | ${table.falseFires} / ${table.negativeRuns} (${pct(table.falseFireRate)}) | ${sib} | ${table.runs} | ${table.totalCostUsd === null ? 'n/a' : table.totalCostUsd.toFixed(4)} |`,
    '', '| Stratum | Runs | Correct |', '| --- | --- | --- |',
    ...Object.entries(table.byStratum).map(([k, v]) => `| ${k} | ${v.runs} | ${v.correct} |`),
  ];
  if (meta.detail?.length) {
    lines.push('', '| Query | Expect | Detected | Cost (USD) |', '| --- | --- | --- | --- |');
    for (const d of meta.detail)
      lines.push(`| ${d.query.replace(/\|/g, '\\|').slice(0, 90)} | ${d.expect} | ${d.runs.map((r) => r.skill ?? 'none').join(', ')} | ${d.runs.map((r) => (typeof r.costUsd === 'number' ? r.costUsd.toFixed(4) : 'n/a')).join(', ')} |`);
  }
  return `${lines.join('\n')}\n`;
}
