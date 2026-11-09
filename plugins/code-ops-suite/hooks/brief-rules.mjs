// The dispatch guard's brief rules as pure, string-only functions. dispatch-guard.mjs imports this
// file statically, as it does agent-file.mjs, and `co brief --check` (scripts/brief-template.mjs) calls reviewBrief
// without a copy of the rules. Not a hook: hooks.json registers no command for it. No import here
// reads a file, the environment, or the ledger; everything the rules need arrives as an argument.
// Every host render that ships dispatch-guard.mjs copies the whole hooks/ tree, so this sibling holds.

// Efforts above this never pass, and the efforts an Agent call may pass (route-unit.mjs ranks the same list).
export const OVER_HIGH_EFFORT = new Set(['xhigh', 'max']);
export const AGENT_EFFORTS = ['low', 'medium', 'high'];
// Agent types that start from the host's full tool surface or inherit the lead's context.
export const WIDE_TYPES = new Set(['general-purpose', 'claude', 'fork']);
// A brief line that justifies a wide or unnamed agent type, with the reason on the same line. An
// empty value does not satisfy it. SCRIPT_WIDE_REASON is the same rule for a Workflow script, where
// the line may sit inside a comment, so it is not anchored to a line start.
export const WIDE_REASON = /^Wide-surface reason:[ \t]*\S/m;
export const SCRIPT_WIDE_REASON = /Wide-surface reason:[ \t]*\S/;
// The fields a routed agent's routing checks read by value. A routed dispatch denies each one whose
// label is present with no readable value, even when the agent's own Contract does not list it.
export const ROUTED_FIELDS = ['Unit', 'Tier', 'Effort', 'Route basis'];

export const UNROUTED_PREMIUM = 'Tier: premium runs the frontier model, but its Route basis cannot be routed (no readable one-line value, or the check failed), '
  + 'so no premium trigger is proven. Add one line, "Route basis: <kind>; surface=<s>; ambiguity=<a>; reversible=<yes|no>", or dispatch at Tier: strong.';

export const word = (value) => value?.split(/[\s,;:()]+/)[0]?.toLowerCase().slice(0, 24) ?? null;

// ---------------------------------------------------------------------------- the field reader

// A brief carries a field when a line starts with the label, case-insensitive, followed by a
// colon. Only leading whitespace, one list marker (`-`, `*`, or `1.`), and bold markers may
// precede the label; bold markers or a parenthetical may sit between it and the colon. A
// markdown heading line that starts with the label also counts. A label mid-line, as in
// `Out of scope:` or `relevant to Scope: x`, does not.
const labelSource = (field) => field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ \\t]+');
const LABEL_HEAD = '^[ \\t]*(?:(?:[-*]|\\d+\\.)[ \\t]+)?(?:\\*\\*|__)?';
const LABEL_TAIL = '(?:\\*\\*|__)?[ \\t]*(?:\\([^)\\n]*\\))?[ \\t]*(?:\\*\\*|__)?[ \\t]*:';
// The block below an empty label or a heading ends only at a line that starts with a known field
// label, or at a heading, never at an arbitrary `Words:` line: `Objective:` followed by
// `Review the guard: check X.` is a value. The known labels are the union of every shipped agent
// Contract's `Brief requires:` fields (Scope through Expected return), the routed fields, and the other
// fields the guard reads by value (Anchors, Route override, Wide-surface reason). The list is static
// because this module reads no file; the dispatch-guard eval reads every plugins/*/agents/*.md
// Contract and fails when a required field is missing here. Built once, at load.
export const KNOWN_LABELS = Object.freeze([
  'Scope', 'Objective', 'Round budget', 'Report cap', 'Report path', 'Expected return',
  ...ROUTED_FIELDS, 'Anchors', 'Route override', 'Wide-surface reason',
]);
const KNOWN_LABEL_LINE = new RegExp(`${LABEL_HEAD}(?:${KNOWN_LABELS.map(labelSource).join('|')})${LABEL_TAIL}`, 'i');
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]/;
const ABSENT = Object.freeze({ state: 'absent', value: null });
const MALFORMED = Object.freeze({ state: 'malformed', value: null });

// The value drops leading quotes and trailing bold markers or quotes, as the agent ledger's own
// reader does, so a `Unit:` value here equals the one the ledger stored.
const cleanValue = (text) => text.replace(/^[`'"]+/, '').replace(/(?:\*\*|__|[`'"])+[ \t]*$/, '').trim();

// One reader for every brief field, with three states:
//   absent    no label line and no heading for the field;
//   value     { value }: the text on the label line, or, when the label is a heading or an empty
//             label line, the block below it up to the next label, heading, or blank line;
//   malformed the label is present and no value can be read.
// The first occurrence in the brief decides, whether it is a label line or a heading. A heading
// takes an inline value only after a colon (`## Tier: strong`); other text after it is the title.
// Callers must treat malformed as a failure, never as absent: it was the null that a presence
// check and a value read disagreed on, and the code that saw null then returned early or allowed.
export function readField(prompt, field) {
  if (typeof prompt !== 'string') return ABSENT;
  const label = labelSource(field);
  const colon = new RegExp(`${LABEL_HEAD}${label}${LABEL_TAIL}[ \\t]*(?:\\*\\*|__)?[ \\t]*([^\\r\\n]*)`, 'im').exec(prompt);
  const heading = new RegExp(`^[ \\t]*#{1,6}[ \\t]+${label}(?![A-Za-z0-9])([^\\r\\n]*)`, 'im').exec(prompt);
  const hit = colon && heading ? (heading.index < colon.index ? heading : colon) : colon ?? heading;
  if (!hit) return ABSENT;
  const inline = hit === colon ? hit[1] : new RegExp(`^${LABEL_TAIL}[ \\t]*(?:\\*\\*|__)?[ \\t]*([^\\r\\n]*)`).exec(hit[1])?.[1] ?? '';
  const direct = cleanValue(inline);
  if (direct) return { state: 'value', value: direct };
  const below = [];
  for (const line of prompt.slice(hit.index + hit[0].length).split(/\r?\n/).slice(1)) {
    if (!line.trim()) {
      if (below.length) break;
      continue;
    }
    if (KNOWN_LABEL_LINE.test(line) || HEADING_LINE.test(line)) break;
    below.push(line.trim());
  }
  const value = cleanValue(below.join(' ').replace(/^(?:[-*]|\d+\.)[ \t]+/, ''));
  return value ? { state: 'value', value } : MALFORMED;
}

// How many times a brief carries a field, in any accepted form: a label line (inline, bold, listed,
// indented) or a heading, in any mix. Only a line that starts with the label counts, so the word in the
// middle of a sentence never does. The scan is one global multiline regex built from the reader's own label
// pieces, not a line split: `^` then matches after `\r`, U+2028, and U+2029 as it does in readField and in
// scripts/agent-ledger.mjs briefLine, so a label on such a line is counted wherever either reads it.
export function fieldCount(prompt, field) {
  if (typeof prompt !== 'string') return 0;
  const label = labelSource(field);
  const colon = new RegExp(`${LABEL_HEAD}${label}${LABEL_TAIL}`, 'gim');
  const heading = new RegExp(`^[ \\t]*#{1,6}[ \\t]+${label}(?![A-Za-z0-9])`, 'gim');
  return [...prompt.matchAll(colon)].length + [...prompt.matchAll(heading)].length;
}

// The routed fields that appear more than once. The guard reads the first heading or label of a field; the
// agent ledger reads the first inline label line and records its Tier, Effort, and Unit. Two readers that
// can pick different lines are what let a premium Tier hide a frontier dispatch from the cap, so a repeat is a denial.
export const repeatedFields = (prompt) => ROUTED_FIELDS.filter((field) => fieldCount(prompt, field) > 1);

export const duplicateDenial = (fields, subject = 'The brief') => `${subject} has ${fields.join(', ')} more than once; `
  + 'each of Unit, Tier, Effort, and Route basis must appear exactly once, as one "Label:" line or one heading, '
  + 'because the guard and the agent ledger read different occurrences. Remove the repeat. To mention a field name at the start of a line '
  + '(a quoted rule, a code block), wrap it in backticks or begin the line with other words: a line that starts with "Tier:" '
  + 'or a "## Tier" heading is read as the field, wherever it sits and whatever text surrounds it.';

// A `Tier: premium` label line, as scripts/agent-ledger.mjs briefLine and wordIn would record it: the
// ledger then exempts the row from the frontier cap. Any such line counts, not only the first, and so does a value that
// only starts with premium (a closing quote or dash after it): a superset of what the ledger records.
const PREMIUM_LABEL = new RegExp(`${LABEL_HEAD}Tier${LABEL_TAIL}[ \\t]*(?:\\*\\*|__)?[ \\t]*[\`'"]*premium(?![A-Za-z0-9])`, 'im');
export const premiumLabelled = (prompt) => typeof prompt === 'string' && PREMIUM_LABEL.test(prompt);

export const UNROUTED_PREMIUM_AGENT = 'Tier: premium on an agent whose Contract does not require Tier gets no routing check, so no premium trigger is proven, '
  + 'and the agent ledger would leave a frontier dispatch out of the one-frontier-peer count. Remove the "Tier: premium" line, '
  + 'or dispatch an agent whose Contract requires Tier, with its Route basis.';

// ---------------------------------------------------------------------------- Route basis, Scope, Anchors

// `Route basis: <kind>; surface=<s>; ambiguity=<a>; reversible=<r>` as its parts.
export function parseRouteBasis(line) {
  const get = (key) => new RegExp(`\\b${key}\\s*=\\s*([A-Za-z-]+)`, 'i').exec(line)?.[1]?.toLowerCase();
  return { kind: line.split(';')[0].trim().toLowerCase(), surface: get('surface'), ambiguity: get('ambiguity'), reversible: get('reversible') };
}

// Path candidates in a Scope text: each token holding a separator, alone and with up to five following
// tokens, so a path with spaces (`35 Contracts and Data`) reaches the surface patterns whole. A bare
// word such as `auth` in prose is never a candidate. A trailing line anchor (`:120-180`, `#L120`) drops.
export function scopePaths(text) {
  const tokens = text.split(/[\s,;`'"()<>[\]{}|]+/)
    .map((token) => token.replace(/[.,:;!?]+$/, '').replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?:[-:]\d+)?)$/i, '')).filter(Boolean);
  const paths = new Set();
  tokens.forEach((token, i) => {
    if (!/[\\/]/.test(token)) return;
    for (let n = 1; n <= 6 && i + n <= tokens.length; n++) paths.add(tokens.slice(i, i + n).join(' '));
  });
  return [...paths];
}

// A brief gives its anchors when its `Anchors` field has a value that is not a bare `none`: a
// block, paths, or `none (<reason>)`. A bare `none`, or `none ()`, names no reason and does not count.
const BARE_NONE = /^none\s*(?:\(\s*\))?\s*[.;]?$/i;
export const anchorsGiven = (prompt) => {
  const field = readField(prompt, 'Anchors');
  return field.state === 'value' && !BARE_NONE.test(field.value);
};

// Behaviour 9. An execution brief for the implementer with no usable `Anchors` field is a denial: the
// kind is the first part of the `Route basis` value. A brief whose Route basis has no value is not
// covered here (the field denial and the Workflow scan advise on it instead). Null, or the text.
export function anchorsDenial(prompt) {
  const basis = readField(prompt, 'Route basis').value;
  if (basis === null || parseRouteBasis(basis).kind !== 'execution' || anchorsGiven(prompt)) return null;
  const given = readField(prompt, 'Anchors').state === 'malformed'
    ? 'has an Anchors label with no value on its line or below it'
    : 'has no Anchors block';
  return `Anchors required: this execution brief for code-ops-suite:implementer ${given}. Run \`co brief `
    + 'code-ops-suite:implementer --anchors <path[:line]>...` with the files the unit will edit, so the operative skips '
    + 'its orientation reads, or add "Anchors: none (<reason>)"; a bare "Anchors: none" with no reason does not count.';
}

// ---------------------------------------------------------------------------- required fields

// The Contract fields a brief lacks. `absent` has no label; `noValue` has a label and no readable
// value. `all` lists both in Contract order, then any routed field outside the Contract that has
// a label and no value, which is what the skeleton and the denial name.
export function missingFields(prompt, required, routed) {
  const absent = [];
  const noValue = [];
  const all = [];
  const outside = routed ? ROUTED_FIELDS.filter((f) => !required.some((r) => r.toLowerCase() === f.toLowerCase())) : [];
  for (const field of [...required, ...outside]) {
    const { state } = readField(prompt, field);
    if (state === 'malformed') { noValue.push(field); all.push(field); }
    // A routed field outside the Contract may be absent; only the Contract's own fields must be there.
    else if (state === 'absent' && required.includes(field)) { absent.push(field); all.push(field); }
  }
  return { absent, noValue, all };
}

// The denial for missing fields. `brief` is the exact `co brief <type>` command that prints the template.
export function missingDenial(type, { noValue, all }, brief) {
  const bare = noValue.length
    ? `${noValue.join(', ')} ${noValue.length > 1 ? 'have' : 'has'} a label but no value on ${noValue.length > 1 ? 'their' : 'its'} line or below it; `
    : '';
  return `The ${type} Contract requires these brief fields, missing: ${all.join(', ')}; ${bare}`
    + 'add each as a "Label:" line or a heading. The missing lines open this denial, ready to fill; '
    + `\`${brief}\` prints the full template; check a brief first with \`${brief} --check <file>\`.`;
}

// ---------------------------------------------------------------------------- routing

// Behaviour 4, routing half, for a dispatch of an agent whose Contract requires `Tier`. Pure given
// `ctx`: { libs, type, prompt, fm, call: { model, effort, grok }, attemptOf(unit) }. `libs` carries the
// route-unit and agent-ledger functions this reads: rungRank, floorRank, efforts, surfaces,
// surfaceOfScope, scopeText, applyMinKind, routeUnit, rungOf. Every denial here tightens the guard; a
// `Route override:` line clears only the shortfalls from the ambiguity and attempt triggers (7b, 7c)
// and the table rows, never a surface trigger. Pushes into `denials` and `advisories` as it goes and
// returns { tier, effective, route }: the brief Tier, the rung the dispatch runs at, and the computed
// route, null when none could be computed. The caller settles the frontier cap from those three.
export function routeChecks(ctx, denials, advisories) {
  const { libs, type, prompt, fm, call } = ctx;
  const floorRung = libs.rungOf(fm?.model);
  const override = call.model;
  // Grok does not run the Claude frontmatter model, so a valid Tier is not compared to it.
  const effective = call.grok && !override ? null : (override ? libs.rungOf(override) : floorRung);
  const tier = word(readField(prompt, 'Tier').value);
  const effort = word(readField(prompt, 'Effort').value);
  const hasOverride = readField(prompt, 'Route override').state === 'value';
  const tierOk = tier !== null && Object.hasOwn(libs.rungRank, tier);
  const effortOk = effort !== null && libs.efforts.includes(effort);

  if (override && effective === null && tier !== null) {
    advisories.push(`The model override "${override}" cannot be ranked, so the guard cannot check Tier: ${tier} against the rung it runs at; confirm they agree.`);
  }
  if (tier !== null && !tierOk) denials.push(`Tier: "${tier}" is not a rung; use light, mid, strong, premium, or frontier.`);
  if (effort !== null && OVER_HIGH_EFFORT.has(effort)) {
    denials.push(`Effort: ${effort} is above high; effort is at most high, and no Route override allows more.`);
  } else if (effort !== null && !effortOk) denials.push(`Effort: "${effort}" is not an effort; use low, medium, or high.`);

  // Rung of the dispatch: the override against the agent floor, then against the brief Tier.
  const belowFloor = override && libs.rungOf(override) && floorRung && libs.floorRank[libs.rungOf(override)] < libs.floorRank[floorRung];
  if (belowFloor) {
    denials.push(`The model override "${override}" runs ${type} at ${libs.rungOf(override)}, below its ${floorRung} floor; `
      + `omit the override so the frontmatter model (${fm.model}) applies.`);
  } else if (tierOk && effective && tier !== effective && !(tier === 'premium' && effective === 'frontier')) {
    // Premium runs the frontier model (model "fable"); only the brief Tier tells the two apart.
    const fix = tier === 'premium' || tier === 'frontier' ? 'pass model "fable"'
      : tier === 'strong' ? 'omit the model override' : `${type} cannot run below its ${floorRung} floor, so raise Tier`;
    denials.push(`Tier: ${tier} but the dispatch runs at ${effective}${override ? ` (model "${override}")` : ` (the frontmatter ${fm.model})`}; ${fix}.`);
  }

  // Effort the host delivers: the Agent call's own `effort` (CLI 2.1.292 and later), else the frontmatter.
  const callEffort = call.effort;
  if (callEffort !== null && !libs.efforts.includes(callEffort)) {
    denials.push(`The Agent call passes effort "${callEffort}"; pass low, medium, or high, because effort is at most high.`);
  }
  const fmEffort = fm?.effort && libs.efforts.includes(fm.effort) ? fm.effort : null;
  const runEffort = callEffort !== null && libs.efforts.includes(callEffort) ? callEffort : fmEffort;
  if (effortOk && runEffort) {
    const asked = libs.efforts.indexOf(effort);
    const given = libs.efforts.indexOf(runEffort);
    const source = runEffort === callEffort ? 'the Agent call passes' : `${type} runs at`;
    if (asked > given) {
      denials.push(`Effort: ${effort} is above the ${runEffort} that ${source}. `
        + `Pass effort: "${effort}" on the Agent call, or use Workflow agent({ agentType, model, effort }).`);
    } else if (asked < given) {
      advisories.push(`Effort: ${effort} is below the ${runEffort} that ${source}. Pass effort: "${effort}" on the Agent call, or use Workflow agent() to run at ${effort}.`);
    }
  }

  // Surface, then the routed floor for Tier and Effort. A Route basis with no value cannot be routed:
  // the field denial names it, and the caller still settles the frontier cap with a null route.
  const basisLine = readField(prompt, 'Route basis').value;
  if (basisLine === null) return { tier, effective, route: null };
  const basis = parseRouteBasis(basisLine);
  // The ledger's scopeText ends a Scope at any `Label:` line, while readField reads a Scope block through an unknown
  // one, so a path under `Scope:` then `Note: x` would derive no surface. Both readings count, so the surface never falls to none that way.
  const derived = libs.surfaceOfScope(scopePaths(`${libs.scopeText(prompt)} ${readField(prompt, 'Scope').value ?? ''}`));
  if (basis.surface === undefined) {
    denials.push('Route basis names no surface=<s>; add it (none, security, egress, migration, public-contract, or gate-script).');
  } else if (!libs.surfaces.includes(basis.surface)) {
    denials.push(`Route basis names surface=${basis.surface}, which is not a surface; use ${libs.surfaces.join(', ')}.`);
  } else if (basis.surface !== derived && derived !== 'none') {
    denials.push(`Route basis says surface=${basis.surface} but the Scope paths derive surface=${derived}; correct the line or the Scope. `
      + `A Route override line does not clear a surface mismatch. Check a brief first with \`${ctx.brief} --check <file>\`.`);
  } else if (basis.surface !== derived) {
    // No Scope path derives a surface (a directory-level Scope, say), so a declared surface routes up; it is never a contradiction.
    advisories.push(`Route basis says surface=${basis.surface} but the Scope paths derive no surface; routing up is allowed, and it costs more.`);
  }
  const unit = (readField(prompt, 'Unit').value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;
  const { kind, raisedFrom } = libs.applyMinKind(basis.kind, type);
  if (raisedFrom) advisories.push(`Route basis kind=${raisedFrom} is below the minimum for ${type}; routing it as ${kind}.`);
  const base = { kind, ambiguity: basis.ambiguity, reversible: basis.reversible, surface: derived };
  const floorTier = ['light', 'mid', 'strong', 'frontier'][libs.floorRank[floorRung]];
  if (floorTier) base.floor = floorTier;
  let full;
  let hard;
  try {
    full = libs.routeUnit({ ...base, attempt: unit ? ctx.attemptOf(unit) : 1 });
    // The surface triggers alone: no ambiguity-and-irreversible trigger, no retry trigger.
    hard = libs.routeUnit({ ...base, reversible: 'yes', attempt: 1 });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    denials.push(`Route basis is not valid: ${error.message}.`);
    return { tier, effective, route: null };
  }
  if (!tierOk) return { tier, effective, route: full };
  const under = (route) => libs.rungRank[tier] < libs.rungRank[route.rung]
    || (effortOk && route.effort !== 'adaptive' && libs.efforts.indexOf(effort) < libs.efforts.indexOf(route.effort));
  const want = (route) => `${route.rung} at ${route.effort} effort (rule ${route.rule}: ${route.why})`;
  if (SURFACE_TRIGGERS.has(hard.rule) && under(hard)) {
    denials.push(`Tier ${tier} / Effort ${effort ?? 'unset'} is below ${want(hard)}; a Route override line does not clear a surface trigger.`);
  } else if (under(full) && !hasOverride) {
    denials.push(`Tier ${tier} / Effort ${effort ?? 'unset'} is below ${want(full)}; raise them (\`co route\` prints the block), `
      + 'or add a "Route override: <reason>" line to depart from the table.');
  }
  if (tier === 'premium' && libs.rungRank.premium > libs.rungRank[full.rung]) {
    // Premium is the Fable model at twice the strong price, so it must be earned; no Route override clears this.
    denials.push(`Tier: premium is above the routed ${full.rung} (rule ${full.rule}), and premium needs a trigger: 7a review or refutation on a surface, `
      + '7b ambiguity high and not reversible, 7c attempt 2 after a failed strong attempt, or 7d judgment at high ambiguity on a public-contract surface. '
      + 'A Route override line does not clear this. Correct the Route basis if it is wrong, or dispatch at Tier: strong.');
  } else if (libs.rungRank[tier] > libs.rungRank[full.rung]) {
    advisories.push(`Tier: ${tier} is above the routed ${full.rung} (rule ${full.rule}); it costs more and is never denied.`);
  }
  return { tier, effective, route: full };
}

const SURFACE_TRIGGERS = new Set(['7a', '7d']);

// ---------------------------------------------------------------------------- the whole brief

// Every prompt-only denial and advisory for one dispatch, in the guard's order, pushed into
// `denials` and `advisories`; returns the skeleton, one `Label:` per missing field, for the caller
// to put first in the text. `ctx`:
//   prompt, type, required   the brief, the subagent type, and the Contract's `Brief requires:` list
//   dispatch, agentTool      an Agent, Task, or spawn call; an Agent or Task call (not a spawn)
//   typeless                 a spawn call that names no subagent_type
//   frontierModel            the dispatch runs the frontier model (the override, else the agent's frontmatter); absent counts as false
//   libs, fm, call, attemptOf   routeChecks' inputs; libs is null when the routing libraries are missing
//   settle({ tier, effective, route })   extra denials that need the ledger (the frontier cap); [] without one
//   unrouted(tier)           denials for a routed dispatch whose route could not be computed (no libs, or a throw)
//   redispatch               the redispatch advisory the guard computed from the ledger, or null
//   brief                    the exact `co brief <type>` command the field denial names
//   budgetNote               the missing-Round-budget advisory text, or null when the call has no prompt string
// The frontier cap, the attempt count, and the redispatch note are ledger reads and stay with the caller.
export function reviewBrief(ctx, denials, advisories) {
  const { prompt, type, required } = ctx;
  if (!ctx.typeless && (!type || WIDE_TYPES.has(type.split(':').pop().toLowerCase())) && !WIDE_REASON.test(prompt)) {
    denials.push(`${type || 'An unnamed type'} starts from a large default or inherited context; `
      + 'dispatch code-ops-suite:implementer, explorer, reviewer, mech, web-researcher, or probe, or add a '
      + '"Wide-surface reason: <why>" line to the brief.');
  }
  const routed = required.some((field) => /^tier$/i.test(field));
  if (ctx.dispatch && routed) {
    const repeated = repeatedFields(prompt);
    if (repeated.length) denials.push(duplicateDenial(repeated));
    const fail = () => denials.push(...(ctx.unrouted?.(word(readField(prompt, 'Tier').value)) ?? []));
    if (!ctx.libs) fail();
    else {
      try {
        denials.push(...(ctx.settle?.(routeChecks(ctx, denials, advisories)) ?? []));
      } catch { fail(); }
    }
  } else if (ctx.agentTool && ctx.call.effort !== null && !AGENT_EFFORTS.includes(ctx.call.effort)) {
    // An unrouted agent never reaches the routing check, so its Agent `effort` is held to the same cap here.
    denials.push(`The Agent call passes effort "${ctx.call.effort}"; pass low, medium, or high, because effort is at most high.`);
  }
  // A dispatch on the frontier model whose Contract has no Tier never meets the cap above, and a Tier: premium line
  // would exempt its ledger row from the count; the caller says when the model is the frontier one.
  if (ctx.dispatch && !routed && ctx.frontierModel && premiumLabelled(prompt)) denials.push(UNROUTED_PREMIUM_AGENT);
  if (ctx.redispatch) advisories.push(ctx.redispatch);
  if (ctx.dispatch && type === 'code-ops-suite:implementer') {
    const anchors = anchorsDenial(prompt);
    if (anchors) denials.push(anchors);
  }
  const missing = missingFields(prompt, required, ctx.dispatch && routed);
  if (missing.all.length) denials.push(missingDenial(type, missing, ctx.brief));
  // A field denial that already names Round budget makes this advisory a repeat.
  const deniedBudget = missing.all.some((field) => /^round budget$/i.test(field));
  if (ctx.budgetNote && !deniedBudget && !/round budget/i.test(prompt)) advisories.push(ctx.budgetNote);
  return missing.all.map((field) => `${field}:`);
}
