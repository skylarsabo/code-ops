const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/random.js')(pl)
const LIBS = ':- use_module(library(random)).\n'

async function ask(goal, program = '', { capture = false } = {}) {
  const session = pl.create(2000000)
  await new Promise((resolve, reject) => session.consult(LIBS + program, { success: resolve, error: reject }))
  const parseError = await new Promise((resolve) => session.query(goal, { success: () => resolve(null), error: resolve }))
  if (parseError !== null) return { answers: [pl.format_answer(parseError)], printed: '' }
  const answers = []
  let printed = ''
  for (let i = 0; i < 50; i++) {
    const write = process.stdout.write
    if (capture) process.stdout.write = (text) => { printed += text; return true }
    let next
    try {
      next = await new Promise((resolve) => session.answer({
        success: (a) => resolve(pl.format_answer(a)),
        fail: () => resolve(null),
        error: (e) => resolve(pl.format_answer(e)),
        limit: () => resolve('limit')
      }))
    } finally {
      process.stdout.write = write
    }
    if (next === null) break
    answers.push(next)
  }
  return { answers, printed }
}

const q = async (goal, program) => (await ask(goal, program)).answers

test("set_seed/1 stores the integer and get_seed/1 returns it", async () => {
  assert.deepEqual(await q('set_seed(42), get_seed(X).'), ['X = 42'])
  let state = 42
  const t0 = state + 0x6D2B79F5
  let t = Math.imul(t0 ^ t0 >>> 15, t0 | 1)
  t ^= t + Math.imul(t ^ t >>> 7, t | 61)
  const first = ((t ^ t >>> 14) >>> 0) / 4294967296
  assert.deepEqual(await q('set_seed(42), random(A).'), ['A = ' + first])
})
