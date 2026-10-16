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

test("dr-1-intersect-side", async () => {
  assert.equal(await ask("ord_intersection([a,b,c],[b,c,d],S)."), "S = [b,c]")
  assert.equal(await ask("ord_intersection([a,b],[c],S)."), "S = []")
  assert.equal(await ask("ord_intersection([f(a),g],[f(a),h],S)."), "S = [f(a)]")
})
