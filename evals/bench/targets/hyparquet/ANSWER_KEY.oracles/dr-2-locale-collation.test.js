import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery, parquetReadObjects } from '../src/index.js'
import { compareAscending } from '../src/order.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('compareAscending orders strings by UTF-16 code unit', () => {
  assert.equal(Math.sign(compareAscending('Z', 'a')), -1)
  assert.equal(Math.sign(compareAscending('a', 'Z')), 1)
  assert.equal(Math.sign(compareAscending('B', 'a')), -1)
  assert.equal(Math.sign(compareAscending('_', 'a')), -1)
  assert.equal(Math.sign(compareAscending('a', 'ab')), -1)
  assert.equal(compareAscending('same', 'same'), 0)
  assert.equal(Math.sign(compareAscending(2, 10)), -1)
  assert.equal(Math.sign(compareAscending(10n, 9n)), 1)
  assert.equal(Math.sign(compareAscending(false, true)), -1)
})

test('parquetQuery sorts text columns the way the relational operators do', async () => {
  const file = load('dictionary_offset_indexed')
  const all = await parquetReadObjects({ file })
  const countries = all.map(r => r.country)
  const want = [...countries].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  const rows = await parquetQuery({ file, orderBy: 'country', columns: ['country'] })
  assert.deepEqual(rows.map(r => r.country), want)
})
