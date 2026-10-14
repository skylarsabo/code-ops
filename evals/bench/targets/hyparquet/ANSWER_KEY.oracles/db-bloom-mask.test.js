import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parquetQuery } from '../src/index.js'

const bytes = readFileSync(new URL('../data/bloom_filter.parquet', import.meta.url))
const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

test('bloom filter lookups keep every row group that holds the value', async () => {
  for (const code of [10, 30, 70, 90]) {
    const plain = await parquetQuery({ file, filter: { code: { $eq: code } } })
    const withBloom = await parquetQuery({ file, filter: { code: { $eq: code } }, useBloomFilters: true })
    assert.equal(plain.length, 1024)
    assert.deepEqual(withBloom, plain, `code ${code}`)
  }
})

test('bloom filter lookups with $in keep matching row groups', async () => {
  const withBloom = await parquetQuery({ file, filter: { code: { $in: [30, 50] } }, useBloomFilters: true })
  assert.equal(withBloom.length, 1024)
  assert.ok(withBloom.every(row => row.code === 30))
})

test('bloom filter lookups still skip a value that no row group holds', async () => {
  const rows = await parquetQuery({ file, filter: { code: { $eq: 50 } }, useBloomFilters: true })
  assert.deepEqual(rows, [])
})
