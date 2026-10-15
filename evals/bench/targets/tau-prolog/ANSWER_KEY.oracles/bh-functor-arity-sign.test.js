const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')

const PRELUDE = ""

async function solve(goal, program = '') {
  const session = pl.create(100000)
  await new Promise((resolve, reject) => session.consult(PRELUDE + program, { success: resolve, error: reject }))
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

test("functor builds a compound", async () => {
  assert.deepEqual(await solve("\\+ \\+ (functor(T, foo, 2), T = foo(a, b))."), ["true"])
})

test("functor builds an atom", async () => {
  assert.deepEqual(await solve("\\+ \\+ (functor(T, foo, 0), T == foo)."), ["true"])
})

test("functor rejects a negative arity", async () => {
  assert.deepEqual(await solve("\\+ \\+ (catch(functor(_, foo, -1), error(domain_error(D, _), _), true), D == not_less_than_zero)."), ["true"])
})
