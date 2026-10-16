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

test("dr-2-keys-values-length", async () => {
  assert.equal(await ask("pairs_keys_values(P,[a,b],[1])."), "false")
  assert.equal(await ask("pairs_keys_values(P,[a],[1,2])."), "false")
  assert.equal(await ask("pairs_keys_values(P,[a,b],[1,2])."), "P = [-(a,1),-(b,2)]")
})
