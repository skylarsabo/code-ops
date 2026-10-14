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

test('readColumn rejects a range whose end precedes its start', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  let outcome
  try {
    outcome = await scan.readColumn({ column: 'id', rowStart: 10, rowEnd: 5 })
  } catch (error) {
    outcome = error
  }
  assert.ok(outcome instanceof RangeError)
  assert.match(outcome.message, /rowEnd/)
})

test('readColumn accepts an ordinary range', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  const values = await scan.readColumn({ column: 'id', rowStart: 5, rowEnd: 10 })
  assert.equal(values.length, 5)
})
