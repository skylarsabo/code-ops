import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// Row group one matches code 10 exactly 1024 times, which is the row limit below.

test('a filtered query stops at the row limit', async () => {
  const rows = await parquetQuery({ file: load('bloom_filter.parquet'), filter: { code: { $in: [10, 30] } }, rowEnd: 1024 })
  assert.equal(rows.length, 1024)
  assert.ok(rows.every(row => row.code === 10))
})

test('a filtered query continues into the next row group when it needs more rows', async () => {
  const rows = await parquetQuery({ file: load('bloom_filter.parquet'), filter: { code: { $in: [10, 30] } }, rowStart: 1020, rowEnd: 1028 })
  assert.deepEqual(rows.map(row => row.code), [10, 10, 10, 10, 30, 30, 30, 30])
})

test('a filtered query honors rowStart before the limit', async () => {
  const rows = await parquetQuery({ file: load('bloom_filter.parquet'), filter: { code: 90 }, rowStart: 2, rowEnd: 5 })
  assert.deepEqual(rows, [{ code: 90 }, { code: 90 }, { code: 90 }])
})
