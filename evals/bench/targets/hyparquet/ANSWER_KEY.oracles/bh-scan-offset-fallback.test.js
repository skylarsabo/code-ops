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

test('scan readColumn reads columns with the default index option', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 195, rowEnd: 200 })), [196n, 197n, 198n, 199n, 200n])
  assert.deepEqual(
    Array.from(await scan.readColumn({ column: 'country', rowStart: 0, rowEnd: 3 })),
    ['Canada', 'United States', 'Japan']
  )
})

test('scan readColumn gives the same values with the offset index turned off', async () => {
  for (const useOffsetIndex of [true, false]) {
    const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet'), useOffsetIndex })
    assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 98, rowEnd: 101 })), [99n, 100n, 101n])
  }
})

test('scan readColumn works on the second row group', async () => {
  const scan = await parquetScan({ file: load('bloom_filter.parquet'), columns: ['code'] })
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 4090, rowEnd: 4096 })), [30, 70, 30, 70, 30, 70])
})
