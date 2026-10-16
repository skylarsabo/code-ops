const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)
require('../modules/random.js')(pl)

const PRELUDE = ":- use_module(library(lists)).\n:- use_module(library(random)).\n"

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

test("random_permutation keeps every element", async () => {
  assert.deepEqual(await solve("\\+ \\+ (random_permutation([a,b,c,d], P), msort(P, S), S == [a,b,c,d])."), ["true"])
})
