import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parquetScan } from '../src/index.js'

const bytes = readFileSync(new URL('../data/bloom_filter.parquet', import.meta.url))
const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

test('a row range that ends on a row group boundary yields no empty range', async () => {
  const scan = await parquetScan({ file, rowStart: 0, rowEnd: 2048 })
  assert.deepEqual(scan.ranges, [{ rowStart: 0, rowEnd: 2048 }])
})

test('a row range that ends inside a later row group keeps both ranges', async () => {
  const scan = await parquetScan({ file, rowStart: 1000, rowEnd: 3000 })
  assert.deepEqual(scan.ranges, [{ rowStart: 1000, rowEnd: 2048 }, { rowStart: 2048, rowEnd: 3000 }])
})

test('a row range that starts on a row group boundary skips the earlier group', async () => {
  const scan = await parquetScan({ file, rowStart: 2048, rowEnd: 4096 })
  assert.deepEqual(scan.ranges, [{ rowStart: 2048, rowEnd: 4096 }])
})
