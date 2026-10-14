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

test('filter with orderBy keeps the sort column only when it was requested', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const expected = [...await parquetReadObjects({ file })].sort(byCountry)

  const all = await parquetQuery({ file, filter: { id: { $gt: 0n } }, orderBy: 'country' })
  assert.deepEqual(all, expected)

  const idOnly = await parquetQuery({ file, filter: { id: { $gt: 0n } }, orderBy: 'country', columns: ['id'] })
  assert.deepEqual(idOnly, expected.map(row => ({ id: row.id })))
})
