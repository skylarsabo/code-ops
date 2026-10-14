import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parquetReadObjects } from '../src/index.js'

const bytes = readFileSync(new URL('../data/datapage_v2.snappy.parquet', import.meta.url))
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

/** An AsyncBuffer whose slice returns a promise, like a file behind a network request. */
const remote = {
  byteLength: buffer.byteLength,
  slice: async (start, end) => buffer.slice(start, end),
}

test('a footer larger than the first fetch reads the same rows as the default fetch', async () => {
  const expected = await parquetReadObjects({ file: remote })
  assert.equal(expected.length, 5)
  const rows = await parquetReadObjects({ file: remote, initialFetchSize: 64 })
  assert.deepEqual(rows, expected)
})
