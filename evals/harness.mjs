// Shared pass/fail tally for the regression evals under evals/*/run.mjs.
//
// tally(format) returns a fresh failure list and the two helpers the evals use:
//   expect(cond, msg)          records msg when cond is falsy and prints nothing.
//   check(name, cond, detail)  prints `ok   name` or `FAIL name`, and records
//                              format(name, detail) when cond is falsy.
// Each eval still prints its own verdict line and chooses its own exit code.

// Record the check name alone.
export const nameOnly = (name) => name;

// Record `name: detail`, keeping the colon when detail is empty.
export const withDetail = (name, detail) => `${name}: ${detail}`;

// Record `name — detail` with detail cut to limit characters, or the name alone.
export const trimmed = (limit) => (name, detail) =>
  detail ? `${name} — ${String(detail).slice(0, limit)}` : name;

export function tally(format = nameOnly) {
  const fails = [];
  const expect = (cond, msg) => { if (!cond) fails.push(msg); };
  const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
    if (!cond) fails.push(format(name, detail));
  };
  return { fails, expect, check };
}
