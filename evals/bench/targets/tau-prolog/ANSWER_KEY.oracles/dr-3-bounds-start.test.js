const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/ranges.js')(pl)

/** Consult the library, run one query, and return its first answer as text. */
async function ask(goal) {
  const session = pl.create()
  await new Promise((resolve, reject) => session.consult(':- use_module(library(ranges)).', { success: resolve, error: reject }))
  await new Promise((resolve, reject) => session.query(goal, { success: resolve, error: reject }))
  return new Promise((resolve) => session.answer({
    success: (a) => resolve(pl.format_answer(a)),
    fail: () => resolve('false'),
    error: (e) => resolve(pl.format_answer(e)),
    limit: () => resolve('limit'),
  }))
}

test("dr-3-bounds-start", async () => {
  assert.equal(await ask("list_bounds([3,1,2],A,B)."), "A = 1, B = 3")
  assert.equal(await ask("list_bounds([5],A,B)."), "A = 5, B = 5")
  assert.equal(await ask("list_bounds([-4,-9],A,B)."), "A = -9, B = -4")
})
