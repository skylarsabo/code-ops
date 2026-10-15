const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/sets.js')(pl)

/** Consult the library, run one query, and return its first answer as text. */
async function ask(goal) {
  const session = pl.create()
  await new Promise((resolve, reject) => session.consult(':- use_module(library(sets)).', { success: resolve, error: reject }))
  await new Promise((resolve, reject) => session.query(goal, { success: resolve, error: reject }))
  return new Promise((resolve) => session.answer({
    success: (a) => resolve(pl.format_answer(a)),
    fail: () => resolve('false'),
    error: (e) => resolve(pl.format_answer(e)),
    limit: () => resolve('limit'),
  }))
}

test("dr-1-list-type", async () => {
  assert.equal(await ask("ord_union([a],foo,S)."), "uncaught exception: error(type_error(list,foo),/(ord_union,3))")
  assert.equal(await ask("list_to_ord_set(foo,S)."), "uncaught exception: error(type_error(list,foo),/(list_to_ord_set,2))")
  assert.equal(await ask("ord_subset(foo,[a])."), "uncaught exception: error(type_error(list,foo),/(ord_subset,2))")
})
