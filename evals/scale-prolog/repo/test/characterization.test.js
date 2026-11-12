// Characterization suite: locks the pristine interpreter's output on a small set of queries.
// Each case consults a program, runs one query, collects every answer asynchronously until
// the query fails, and compares the formatted answers (pl.format_answer) against the values
// recorded from the pristine source.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)
require('../modules/format.js')(pl)
require('../modules/charsio.js')(pl)

const PROGRAM = `
:- use_module(library(lists)).
:- use_module(library(format)).
:- use_module(library(charsio)).
parent(tom, bob).
parent(tom, liz).
parent(bob, ann).
parent(bob, pat).
ancestor(X, Y) :- parent(X, Y).
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
fact(0, 1) :- !.
fact(N, F) :- N > 0, M is N - 1, fact(M, G), F is N * G.
color(red). color(green). color(blue).
`

const CASES = [
  'append([1,2], [3], L).',
  'append(X, Y, [a,b]).',
  'member(X, [a,b,c]).',
  'member(z, [a,b,c]).',
  'length([a,b,c], N).',
  'length(L, 2), L = [x,y].',
  'sort([c,a,b,a], S).',
  'X is 7 * 6 + 2 ** 3.',
  'X is 17 mod 5, Y is 17 // 5, Z is -17 // 5.',
  'fact(6, F).',
  'ancestor(tom, X).',
  'findall(X-Y, parent(X, Y), L).',
  'findall(X, color(X), L), length(L, N).',
  'bagof(X, parent(X, Y), L).',
  'atom_codes(abc, L).',
  'atom_codes(A, [104,105]).',
  'atom_length(hello, N).',
  'atom_chars(X, [a,b]), atom_concat(X, c, Y).',
  'copy_term(f(a,g(b)), C).',
  'format("~w and ~a~n", [foo, bar]).',
  'format("~d items~n", [3]).',
  'X = 1 ; X = 2.',
  'color(X), X @> green.',
  'atom_length(X, 3).',
  'foo(1).'
]

/**
 * Run one query to exhaustion; return its formatted answers, plus any text it wrote to
 * stdout. Stdout is swapped only while one answer is computed, which finishes
 * synchronously, so the test runner's own output never lands in the capture.
 */
async function run(goal) {
  const session = pl.create()
  await new Promise((resolve, reject) => session.consult(PROGRAM, { success: resolve, error: reject }))
  const parseError = await new Promise((resolve) => session.query(goal, { success: () => resolve(null), error: resolve }))
  if (parseError !== null) return [pl.format_answer(parseError)]
  const out = []
  let printed = ''
  for (let i = 0; i < 50; i++) {
    const write = process.stdout.write
    process.stdout.write = (text) => { printed += text; return true }
    let next
    try {
      next = await new Promise((resolve) => session.answer({
        success: (a) => resolve(pl.format_answer(a)),
        fail: () => resolve(null),
        error: (e) => resolve(pl.format_answer(e)),
        limit: () => resolve(null)
      }))
    } finally {
      process.stdout.write = write
    }
    if (next === null) break
    out.push(next)
  }
  return printed ? [...out, `stdout: ${printed}`] : out
}

const expectedPath = join(__dirname, 'expected.json')
const expected = process.env.NODE_TEST_CONTEXT ? JSON.parse(readFileSync(expectedPath, 'utf8')) : {}

for (const goal of CASES) {
  if (process.env.NODE_TEST_CONTEXT) {
    test(goal, async () => {
      assert.deepEqual(await run(goal), expected[goal])
    })
  }
}

module.exports = { CASES, run }
