const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/promises.js')(pl)

test("promiseConsult rejects a program with a syntax error", async () => {
  const session = pl.create()
  await assert.rejects(session.promiseConsult('foo(.'))
  await session.promiseConsult('foo(1).')
})
