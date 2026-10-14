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

// int_array and nested_struct are group columns, so no physical column carries their own name.

test('a filter on a list column reads and matches rows', async () => {
  const file = load('nullable.impala.parquet')
  const rows = await parquetReadObjects({ file, columns: ['id'], filter: { int_array: { $in: [[1, 2, 3]] } } })
  assert.deepEqual(rows, [{ id: 1n }])
})

test('a filter on a struct column reads and matches rows', async () => {
  const file = load('nullable.impala.parquet')
  const all = await parquetReadObjects({ file })
  const want = all.filter(row => row.nested_struct && row.nested_struct.A === 7).map(row => row.id)
  assert.ok(want.length >= 1)
  const rows = await parquetReadObjects({ file, columns: ['id'], filter: { 'nested_struct.A': 7 } })
  assert.deepEqual(rows.map(row => row.id), want)
  const whole = await parquetReadObjects({ file, columns: ['id'], filter: { nested_struct: { $ne: null } } })
  assert.deepEqual(whole.map(row => row.id), all.map(row => row.id))
})
