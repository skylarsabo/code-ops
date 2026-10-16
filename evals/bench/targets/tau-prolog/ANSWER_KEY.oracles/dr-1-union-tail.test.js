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

test("dr-1-union-tail", async () => {
  assert.equal(await ask("ord_union([c],[a],S)."), "S = [a,c]")
  assert.equal(await ask("ord_union([a,b],[a],S)."), "S = [a,b]")
  assert.equal(await ask("ord_union([a,c],[b],S)."), "S = [a,b,c]")
})
