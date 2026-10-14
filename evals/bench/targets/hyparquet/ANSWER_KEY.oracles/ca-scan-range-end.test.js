import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetScan } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('scan ranges stop at rowEnd when it falls on a row group boundary', async () => {
  const file = load('bloom_filter.parquet')
  const upToBoundary = await parquetScan({ file, rowEnd: 2048 })
  assert.deepEqual(upToBoundary.ranges, [{ rowStart: 0, rowEnd: 2048 }])
  const insideSecond = await parquetScan({ file, rowStart: 2048, rowEnd: 3000 })
  assert.deepEqual(insideSecond.ranges, [{ rowStart: 2048, rowEnd: 3000 }])
})
