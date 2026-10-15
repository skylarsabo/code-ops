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

test("sub_atom enumerates every split", async () => {
  assert.deepEqual(await solve("sub_atom(abc, B, 1, A, S)."), ["B = 0, A = 2, S = a","B = 1, A = 1, S = b","B = 2, A = 0, S = c"])
})

test("sub_atom with a bound middle", async () => {
  assert.deepEqual(await solve("sub_atom(hello, 1, 3, A, S)."), ["A = 1, S = ell"])
})
