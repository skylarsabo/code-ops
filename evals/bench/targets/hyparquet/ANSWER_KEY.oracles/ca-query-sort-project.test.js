import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const byCountry = (a, b) => a.country < b.country ? -1 : a.country > b.country ? 1 : 0

test('filtered rows are sorted by a column that the result leaves out', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const sorted = [...await parquetReadObjects({ file })].sort(byCountry)
  const filter = { id: { $gt: 0n } }

  const all = await parquetQuery({ file, filter, orderBy: 'country', columns: ['id'] })
  assert.deepEqual(all, sorted.map(row => ({ id: row.id })))

  const page = await parquetQuery({ file, filter, orderBy: 'country', columns: ['id'], rowStart: 3, rowEnd: 8 })
  assert.deepEqual(page, sorted.slice(3, 8).map(row => ({ id: row.id })))
})
