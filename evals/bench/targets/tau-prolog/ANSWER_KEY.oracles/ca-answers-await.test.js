const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/promises.js')(pl)

test("promiseAnswers ends after the last answer", async () => {
  const session = pl.create()
  await session.promiseConsult('p(a). p(b).')
  await session.promiseQuery('p(X).')
  const seen = []
  for await (const answer of session.promiseAnswers()) {
    seen.push(pl.format_answer(answer))
    if (seen.length >= 6) break
  }
  assert.deepEqual(seen, ['X = a', 'X = b'])
})
