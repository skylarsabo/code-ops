const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/os.js')(pl)
const LIBS = ':- use_module(library(os)).\n'

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

test("size_file/2 reports the byte size of the file", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'tp-ca-'))
  try {
    const file = join(dir, 'ten.txt').replace(/\\/g, '/')
    writeFileSync(file, '0123456789')
    assert.deepEqual(await q("size_file('" + file + "', S)."), ['S = 10'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
