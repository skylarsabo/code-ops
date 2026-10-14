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

test('scan readColumn rejects a range that ends before it starts', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  assert.throws(() => scan.readColumn({ column: 'id', rowStart: 5, rowEnd: 3 }), RangeError)
  assert.throws(() => scan.readColumn({ column: 'id', rowStart: 5, rowEnd: 3 }), /rowEnd must be/)
})

test('scan readColumn accepts empty and ordinary ranges', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 5, rowEnd: 5 })), [])
  assert.deepEqual(Array.from(await scan.readColumn({ column: 'id', rowStart: 5, rowEnd: 7 })), [6n, 7n])
})

test('scan readColumn rejects ranges that are not whole rows', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  assert.throws(() => scan.readColumn({ column: 'id', rowStart: 0, rowEnd: 2.5 }), RangeError)
  assert.throws(() => scan.readColumn({ column: 'id', rowStart: -1, rowEnd: 2 }), RangeError)
})
