const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/promises.js')(pl)

test("promiseConsult works without options", async () => {
  const session = pl.create()
  await session.promiseConsult('q(1). q(2).')
  await session.promiseQuery('q(X).')
  assert.equal(pl.format_answer(await session.promiseAnswer()), 'X = 1')
  assert.equal(pl.format_answer(await session.promiseAnswer()), 'X = 2')
})
