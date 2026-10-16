const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')

const LIBS = ''

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

test("abolish/1 accepts arity zero", async () => {
  assert.deepEqual(await q('abolish(tp_flag/0).', ':- dynamic(tp_flag/0).\ntp_flag.'), ['true'])
  assert.deepEqual(await q('abolish(tp_flag/(-1)).'), ['uncaught exception: error(domain_error(not_less_than_zero,-1),/(abolish,1))'])
})
