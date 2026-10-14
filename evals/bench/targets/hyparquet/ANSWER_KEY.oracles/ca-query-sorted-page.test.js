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
const pick = rows => rows.map(row => [row.id, row.country])

test('orderBy pages through the sorted order, not the file order', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const sorted = [...await parquetReadObjects({ file })].sort(byCountry)

  const firstPage = await parquetQuery({ file, orderBy: 'country', rowStart: 0, rowEnd: 3 })
  assert.deepEqual(pick(firstPage), pick(sorted.slice(0, 3)))

  const laterPage = await parquetQuery({ file, orderBy: 'country', rowStart: 2, rowEnd: 5 })
  assert.deepEqual(pick(laterPage), pick(sorted.slice(2, 5)))
})
