const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/promises.js')(pl)

test('promiseAnswers yields each answer, then ends', async () => {
  const session = pl.create(100000)
  await session.promiseConsult('p(1). p(2).')
  await session.promiseQuery('p(X).')
  const got = []
  for await (const answer of session.promiseAnswers()) {
    got.push(pl.format_answer(answer))
    if (got.length >= 5) break
  }
  assert.deepEqual(got, ['X = 1', 'X = 2'])
})
