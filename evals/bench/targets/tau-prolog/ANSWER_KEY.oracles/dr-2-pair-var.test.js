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

test("dr-2-pair-var", async () => {
  assert.equal(await ask("pairs_keys([a-1,X],K)."), "uncaught exception: error(instantiation_error,/(pairs_keys,2))")
  assert.equal(await ask("transpose_pairs([X],T)."), "uncaught exception: error(instantiation_error,/(transpose_pairs,2))")
  assert.equal(await ask("pairs_keys([a-1,foo],K)."), "uncaught exception: error(type_error(pair,foo),/(pairs_keys,2))")
})
