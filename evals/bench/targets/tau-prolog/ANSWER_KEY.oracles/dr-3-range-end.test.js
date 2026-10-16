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

test("dr-3-range-end", async () => {
  assert.equal(await ask("range_list(1,4,L)."), "L = [1,2,3,4]")
  assert.equal(await ask("range_list(3,3,L)."), "L = [3]")
  assert.equal(await ask("range_list(4,1,L)."), "false")
})
