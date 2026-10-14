import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata } from '../src/index.js'
import { prefetchPageIndexes } from '../src/plan.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('page indexes cover the filter column and every other selected column once', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const metadata = parquetMetadata(file)
  const result = await prefetchPageIndexes({ file, metadata, filter: { id: { $gte: 1n } } })
  assert.deepEqual(result.pageRangesByGroup, [[[0, 200]]])
  assert.deepEqual(Object.keys(result.pageLocationsByGroup[0]).sort(), ['country', 'id'])
  for (const pages of Object.values(result.pageLocationsByGroup[0])) {
    assert.ok(pages.length >= 1)
    assert.equal(Number(pages[0].first_row_index), 0)
  }

  const narrowed = await prefetchPageIndexes({ file, metadata, filter: { id: { $gte: 1n } }, columns: ['id'] })
  assert.deepEqual(Object.keys(narrowed.pageLocationsByGroup[0]), ['id'])
})
