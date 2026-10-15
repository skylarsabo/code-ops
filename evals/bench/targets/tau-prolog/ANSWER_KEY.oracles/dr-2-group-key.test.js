const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/pairs.js')(pl)

/** Consult the library, run one query, and return its first answer as text. */
async function ask(goal) {
  const session = pl.create()
  await new Promise((resolve, reject) => session.consult(':- use_module(library(pairs)).', { success: resolve, error: reject }))
  await new Promise((resolve, reject) => session.query(goal, { success: resolve, error: reject }))
  return new Promise((resolve) => session.answer({
    success: (a) => resolve(pl.format_answer(a)),
    fail: () => resolve('false'),
    error: (e) => resolve(pl.format_answer(e)),
    limit: () => resolve('limit'),
  }))
}

test("dr-2-group-key", async () => {
  assert.equal(await ask("group_pairs_by_key([a-1,a-2,b-3,b-4],G)."), "G = [-(a,[1,2]),-(b,[3,4])]")
  assert.equal(await ask("group_pairs_by_key([a-1,b-2,b-3,a-4],G)."), "G = [-(a,[1]),-(b,[2,3]),-(a,[4])]")
})
