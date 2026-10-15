const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)

const PRELUDE = ":- use_module(library(lists)).\n"

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

test("max_list finds the largest integer", async () => {
  assert.deepEqual(await solve("\\+ \\+ (max_list([3,9,9,2], M), M == 9)."), ["true"])
})

test("max_list of one element", async () => {
  assert.deepEqual(await solve("\\+ \\+ (max_list([4], M), M == 4)."), ["true"])
})
