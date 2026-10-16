const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)

// Consult `program`, run `goal`, and return its formatted answers (at most 20).
async function answers(program, goal) {
  const session = pl.create()
  await new Promise((resolve, reject) => session.consult(':- use_module(library(lists)).\n' + program, { success: resolve, error: reject }))
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

test('sort/2 orders compound terms that differ only in the last argument', async () => {
  assert.deepEqual(await answers('', 'sort([point(1,5), point(1,3)], S).'), ['S = [point(1,3),point(1,5)]'])
  assert.deepEqual(await answers('', 'sort([f(a,b,3), f(a,b,2), f(a,b,2)], S).'), ['S = [f(a,b,2),f(a,b,3)]'])
})

test('msort/2 and setof/3 order the same terms the same way', async () => {
  assert.deepEqual(await answers('', 'msort([point(1,5), point(1,3), point(1,5)], S).'), ['S = [point(1,3),point(1,5),point(1,5)]'])
  assert.deepEqual(await answers('', 'setof(P, member(P, [point(1,5), point(1,3)]), L).'), ['L = [point(1,3),point(1,5)]'])
})

test('compare/3 and the term comparison operators see the last argument', async () => {
  assert.deepEqual(await answers('', 'compare(O, point(1,5), point(1,3)).'), ['O = (>)'])
  assert.deepEqual(await answers('', 'compare(O, point(1,3), point(1,5)).'), ['O = (<)'])
  assert.deepEqual(await answers('', 'compare(O, point(1,3), point(1,3)).'), ['O = (=)'])
  assert.deepEqual(await answers('', 'point(1,3) @< point(1,5).'), ['true'])
  assert.deepEqual(await answers('', 'point(1,5) @=< point(1,3).'), [])
  assert.deepEqual(await answers('', 'compare(O, f(a, g(1,2)), f(a, g(1,1))).'), ['O = (>)'])
})

test('keysort/2 orders compound keys that differ only in the last argument', async () => {
  assert.deepEqual(await answers('', 'keysort([k(1,2)-a, k(1,1)-b, k(1,2)-c], L).'), ['L = [-(k(1,1),b),-(k(1,2),a),-(k(1,2),c)]'])
})
