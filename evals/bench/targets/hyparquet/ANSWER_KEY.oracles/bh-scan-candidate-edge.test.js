import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetScan } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// bloom_filter.parquet has two row groups, [0, 2048) and [2048, 4096).

test('scan ranges follow the row groups', async () => {
  const scan = await parquetScan({ file: load('bloom_filter.parquet') })
  assert.deepEqual(scan.ranges, [{ rowStart: 0, rowEnd: 2048 }, { rowStart: 2048, rowEnd: 4096 }])
})

test('scan readColumn finds the range that starts on a row group boundary', async () => {
  const scan = await parquetScan({ file: load('bloom_filter.parquet') })
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 2048, rowEnd: 2052 })), [30, 70, 30, 70])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 2044, rowEnd: 2048 })), [10, 90, 10, 90])
})

test('scan readColumn rejects a range that spans two row groups', async () => {
  const scan = await parquetScan({ file: load('bloom_filter.parquet') })
  assert.throws(() => scan.readColumn({ column: 'code', rowStart: 2046, rowEnd: 2050 }), /outside scan ranges/)
})
