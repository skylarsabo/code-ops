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

test('a repeat read inside the cached range returns the matching slice', async () => {
  const scan = await parquetScan({ file: load('bloom_filter.parquet') })
  const first = await scan.readColumn({ column: 'code', rowStart: 0, rowEnd: 8 })
  assert.deepEqual(Array.from(first), [10, 90, 10, 90, 10, 90, 10, 90])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 2, rowEnd: 5 })), [10, 90, 10])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 4, rowEnd: 8 })), [10, 90, 10, 90])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'code', rowStart: 7, rowEnd: 8 })), [90])
})

test('a cached range that starts after the group start', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  await scan.readColumn({ column: 'id', rowStart: 10, rowEnd: 20 })
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 15, rowEnd: 20 })), [16n, 17n, 18n, 19n, 20n])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 10, rowEnd: 12 })), [11n, 12n])
})
