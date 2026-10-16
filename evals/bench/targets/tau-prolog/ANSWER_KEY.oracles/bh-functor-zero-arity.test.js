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

test("functor builds a number from arity zero", async () => {
  assert.deepEqual(await solve("\\+ \\+ (functor(T, 3, 0), T == 3)."), ["true"])
})

test("functor still rejects a number name with arguments", async () => {
  assert.deepEqual(await solve("\\+ \\+ (catch(functor(_, 3, 1), error(type_error(Type, _), _), true), Type == atom)."), ["true"])
})
