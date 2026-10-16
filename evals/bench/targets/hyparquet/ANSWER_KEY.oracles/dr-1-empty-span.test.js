import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetCountNulls, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('parquetCountNulls handles ranges that touch row group boundaries', async () => {
  const file = load('bloom_filter')
  for (const [rowStart, rowEnd] of [[2048, 2048], [2047, 2048], [2048, 2049], [0, 1], [4095, 4096], [4096, 5000], [0, 99999], [0, 0]]) {
    assert.equal(await parquetCountNulls({ file, column: 'code', rowStart, rowEnd }), 0, rowStart + '-' + rowEnd)
  }
})

test('parquetCountNulls counts missing values by range', async () => {
  const file = load('datapage_v2.snappy')
  const rows = await parquetReadObjects({ file })
  const want = (start, end) => rows.slice(start, end).filter(r => r.a === null || r.a === undefined).length
  for (const [rowStart, rowEnd] of [[0, 5], [0, 3], [3, 4], [3, 5], [4, 5], [2, 99], [5, 9], [1, 1]]) {
    assert.equal(await parquetCountNulls({ file, column: 'a', rowStart, rowEnd }), want(rowStart, rowEnd), rowStart + '-' + rowEnd)
  }
  await assert.rejects(parquetCountNulls({ file, column: 'a', rowStart: -1 }), /rowStart/)
  await assert.rejects(parquetCountNulls({ file: {}, column: 'a' }), /AsyncBuffer/)
})
