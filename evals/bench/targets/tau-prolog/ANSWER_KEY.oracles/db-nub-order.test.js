const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)

// Consult `program`, run `goal`, and return its formatted answers (at most 20).
async function answers(program, goal) {
  const session = pl.create()
  await new Promise((resolve, reject) => session.consult(':- use_module(library(lists)).\n' + program, { success: resolve, error: reject }))
  const parseError = await new Promise((resolve) => session.query(goal, { success: () => resolve(null), error: resolve }))
  if (parseError !== null) return [pl.format_answer(parseError)]
  const out = []
  for (let i = 0; i < 20; i++) {
    const next = await new Promise((resolve) => session.answer({
      success: (a) => resolve(pl.format_answer(a)),
      fail: () => resolve(null),
      error: (e) => resolve(pl.format_answer(e)),
      limit: () => resolve(null)
    }))
    if (next === null) break
    out.push(next)
  }
  return out
}

test('term_variables/2 lists variables in order of first occurrence', async () => {
  assert.deepEqual(await answers('', 'term_variables(f(X, Y, X), L), L = [X, Y].'), ['L = [X,Y]'])
  assert.deepEqual(await answers('', 'term_variables(g(A, h(B, C), A), [P, Q, R]), P == A, Q == B, R == C.'), ['A = P, B = Q, C = R'])
  assert.deepEqual(await answers('', 'term_variables(g(Z), L), L = [Z].'), ['L = [Z]'])
})

test('term_variables/3 keeps the tail after the ordered variables', async () => {
  assert.deepEqual(await answers('', 'term_variables(f(X, Y, X), L, [t]), L = [X, Y, t].'), ['L = [X,Y,t]'])
})

test('numbervars/3 numbers variables in order of first occurrence', async () => {
  assert.deepEqual(await answers('', 'numbervars(f(X, Y, X), 0, E).'), ['X = $VAR(0), Y = $VAR(1), E = 2'])
  assert.deepEqual(await answers('', 'numbervars(g(A, h(B), A, C), 3, E).'), ['A = $VAR(3), B = $VAR(4), C = $VAR(5), E = 6'])
})
