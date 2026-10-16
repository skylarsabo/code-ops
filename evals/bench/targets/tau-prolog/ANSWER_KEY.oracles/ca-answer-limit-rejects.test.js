const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/promises.js')(pl)

test("promiseAnswer rejects when the step limit is reached", async () => {
  const session = pl.create(200)
  await session.promiseConsult('spin :- spin.')
  await session.promiseQuery('spin.')
  await assert.rejects(session.promiseAnswer())
})
