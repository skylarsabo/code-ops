import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parquetMetadata, parquetQuery, parquetReadObjects } from '../src/index.js'

/** @param {string} name */
function load(name) {
  const bytes = readFileSync(new URL(`../data/${name}`, import.meta.url))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

test('a less-than-or-equal filter keeps the row group that holds the lowest values', async () => {
  const file = load('bloom_filter.parquet')
  const rows = await parquetQuery({ file, filter: { code: { $lte: 20 } } })
  assert.equal(rows.length, 1024)
  assert.ok(rows.every(row => row.code === 10))
  const high = await parquetQuery({ file, filter: { code: { $gte: 30 } } })
  assert.equal(high.length, 3072)
})

test('the footer reports the lowest and highest value of each row group', () => {
  const { row_groups: groups } = parquetMetadata(load('bloom_filter.parquet'))
  const bounds = groups.map(group => {
    const { min_value: min, max_value: max } = group.columns[0].meta_data?.statistics ?? {}
    return [min, max]
  })
  assert.deepEqual(bounds, [[10, 90], [30, 70]])
})

test('a string filter keeps the row group that holds the lowest text', async () => {
  const file = load('geospatial.parquet')
  const all = await parquetReadObjects({ file })
  const rows = await parquetReadObjects({ file, filter: { wkt: { $lt: 'H' } } })
  assert.equal(rows.length, 4)
  assert.deepEqual(rows, all.filter(row => row.wkt < 'H'))
})
