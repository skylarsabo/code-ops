import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('a filter column outside the selection is dropped from the rows', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const want = all.filter(row => row.country === 'Canada').map(row => ({ id: row.id }))
  assert.ok(want.length > 10)
  const rows = await parquetReadObjects({ file, columns: ['id'], filter: { country: 'Canada' } })
  assert.deepEqual(rows, want)
})

test('a filter column inside the selection stays in the rows', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const want = all.filter(row => row.country === 'India')
  const rows = await parquetReadObjects({ file, columns: ['country', 'id'], filter: { country: 'India' } })
  assert.deepEqual(rows, want)
})

test('a filter without a column selection returns whole rows', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const want = all.filter(row => row.id > 150n)
  const rows = await parquetReadObjects({ file, filter: { id: { $gt: 150n } } })
  assert.deepEqual(rows, want)
})
