import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery } from '../src/index.js'
import { isMissing } from '../src/order.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('isMissing covers both decoded forms of a missing value', () => {
  assert.equal(isMissing(null), true)
  assert.equal(isMissing(undefined), true)
  for (const present of [0, 0n, '', false, [], {}]) assert.equal(isMissing(present), false)
})

test('parquetQuery orders a nested column with missing lists', async () => {
  const file = load('datapage_v2.snappy')
  const order = async (flags, extra = {}) =>
    (await parquetQuery({ file, orderBy: 'e', columns: ['b', 'e'], ...flags, ...extra })).map(r => r.b)
  // e holds [1, 2, 3], missing, missing, [1, 2, 3], [1, 2] in file order, with b = 1..5
  assert.deepEqual(await order({}), [5, 1, 4, 2, 3])
  assert.deepEqual(await order({ descending: true }), [1, 4, 5, 2, 3])
  assert.deepEqual(await order({ nullsFirst: true }), [2, 3, 5, 1, 4])
  assert.deepEqual(await order({ descending: true, nullsFirst: true }), [2, 3, 1, 4, 5])
  const filter = { b: { $gt: 0 } }
  assert.deepEqual(await order({}, { filter }), [5, 1, 4, 2, 3])
  assert.deepEqual(await order({ nullsFirst: true }, { filter }), [2, 3, 5, 1, 4])
})
