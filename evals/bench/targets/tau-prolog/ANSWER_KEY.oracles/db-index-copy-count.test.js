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

const KIND = 'kind(_, any).\nkind(a, letter).\nkind(b, letter).\n'

test('a consulted clause with a variable first argument answers a bound first argument', async () => {
  assert.deepEqual(await answers(KIND, 'findall(K, kind(a, K), L).'), ['L = [any,letter]'])
  assert.deepEqual(await answers(KIND, 'findall(K, kind(c, K), L).'), ['L = [any]'])
  assert.deepEqual(await answers(KIND, 'findall(K, kind(X, K), L).'), ['L = [any,letter,letter]'])
})

test('several variable-first clauses all reach a later indexed clause', async () => {
  const program = 'rule(_, one).\nrule(_, two).\nrule(x, three).\n'
  assert.deepEqual(await answers(program, 'findall(V, rule(x, V), L).'), ['L = [one,two,three]'])
})

test('assertz, asserta, and retract keep a variable-first clause visible', async () => {
  const dyn = ':- dynamic(item/2).\nitem(a, one).\n'
  assert.deepEqual(await answers(dyn, 'assertz(item(_, any)), assertz(item(b, x)), findall(K, item(b, K), L).'), ['L = [any,x]'])
  assert.deepEqual(await answers(dyn, 'asserta(item(_, any)), asserta(item(a, two)), findall(K, item(a, K), L).'), ['L = [two,any,one]'])
  assert.deepEqual(await answers(dyn, 'assertz(item(_, any)), assertz(item(_, other)), assertz(item(a, three)), findall(K, item(a, K), L).'), ['L = [one,any,other,three]'])
  assert.deepEqual(await answers(dyn, 'assertz(item(_, any)), assertz(item(b, x)), retract(item(b, x)), findall(K, item(b, K), L).'), ['L = [any]'])
})
