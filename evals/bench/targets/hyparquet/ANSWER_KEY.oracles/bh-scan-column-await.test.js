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

test('scan readColumn returns the requested values', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  assert.deepEqual(scan.ranges, [{ rowStart: 0, rowEnd: 200 }])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 0, rowEnd: 3 })), [1n, 2n, 3n])
  assert.deepEqual(
    Array.from(await scan.readColumn({ column: 'country', rowStart: 98, rowEnd: 101 })),
    ['Canada', 'India', 'India']
  )
})

test('scan readColumn reads a range inside the second row group', async () => {
  const scan = await parquetScan({ file: load('bloom_filter.parquet') })
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 2050, rowEnd: 2054 })), [30, 70, 30, 70])
})
