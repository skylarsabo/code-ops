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

test('orderBy sorts the whole column before it takes the requested rows', async () => {
  const rows = await parquetQuery({ file: load('bloom_filter.parquet'), orderBy: 'code', rowStart: 1024, rowEnd: 1026 })
  assert.deepEqual(rows, [{ __index__: 2048, code: 30 }, { __index__: 2050, code: 30 }])
})

test('orderBy with a row limit returns the smallest values', async () => {
  const rows = await parquetQuery({ file: load('dictionary_offset_indexed.parquet'), orderBy: 'id', rowEnd: 3, columns: ['id'] })
  assert.deepEqual(rows.map(row => row.id), [1n, 2n, 3n])
  const ascending = await parquetQuery({ file: load('dictionary_offset_indexed.parquet'), orderBy: 'country', rowStart: 0, rowEnd: 2, columns: ['country'] })
  assert.deepEqual(ascending.map(row => row.country), ['Australia', 'Australia'])
})
