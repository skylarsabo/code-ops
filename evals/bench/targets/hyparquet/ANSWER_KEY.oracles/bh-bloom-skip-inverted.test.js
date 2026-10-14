import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('bloom filters keep a row group that holds the value', async () => {
  const file = load('bloom_filter.parquet')
  const rows = await parquetReadObjects({ file, filter: { code: 10 }, useBloomFilters: true })
  assert.equal(rows.length, 1024)
  assert.ok(rows.every(row => row.code === 10))
  const second = await parquetReadObjects({ file, filter: { code: { $eq: 70 } }, useBloomFilters: true })
  assert.equal(second.length, 1024)
})

test('bloom filters prune a value that no row group holds', async () => {
  const file = load('bloom_filter.parquet')
  assert.deepEqual(await parquetReadObjects({ file, filter: { code: 50 }, useBloomFilters: true }), [])
  assert.deepEqual(await parquetReadObjects({ file, filter: { code: { $in: [50, 60] } }, useBloomFilters: true }), [])
})
