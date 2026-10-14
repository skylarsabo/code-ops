// Acceptance test for parquetColumnSummary.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetColumnSummary, parquetMetadata } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function metadataOf(name) {
  const buf = readFileSync(join(dataDir, name))
  return parquetMetadata(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/**
 * Build a column chunk. `nulls` is a bigint null count, 'none' for statistics
 * without a null count, or 'nostats' for no statistics at all.
 *
 * @param {string[]} path
 * @param {{ type?: string, values: bigint, compressed: bigint, uncompressed: bigint, nulls?: bigint | 'none' | 'nostats' }} spec
 */
function chunk(path, { type = 'INT32', values, compressed, uncompressed, nulls = 'nostats' }) {
  /** @type {any} */
  const meta_data = {
    type,
    path_in_schema: path,
    num_values: values,
    total_compressed_size: compressed,
    total_uncompressed_size: uncompressed,
  }
  if (nulls === 'none') meta_data.statistics = { min_value: 1, max_value: 9 }
  else if (nulls !== 'nostats') meta_data.statistics = { null_count: nulls }
  return { file_offset: 0n, meta_data }
}

/** @param {any[][]} groups */
const metadataFrom = (groups) => /** @type {any} */ ({ row_groups: groups.map(columns => ({ columns })) })

test('no row groups gives an empty array', () => {
  assert.deepEqual(parquetColumnSummary(/** @type {any} */ ({ row_groups: [] })), [])
})

test('one row group converts bigint to number and keeps a zero null count', () => {
  const summary = parquetColumnSummary(metadataFrom([[
    chunk(['id'], { type: 'INT64', values: 10n, compressed: 100n, uncompressed: 160n, nulls: 0n }),
    chunk(['name'], { type: 'BYTE_ARRAY', values: 10n, compressed: 50n, uncompressed: 70n, nulls: 4n }),
  ]]))
  assert.deepEqual(summary, [
    { name: 'id', type: 'INT64', numValues: 10, nullCount: 0, compressedBytes: 100, uncompressedBytes: 160 },
    { name: 'name', type: 'BYTE_ARRAY', numValues: 10, nullCount: 4, compressedBytes: 50, uncompressedBytes: 70 },
  ])
  for (const entry of summary) {
    for (const key of ['numValues', 'compressedBytes', 'uncompressedBytes']) {
      assert.equal(typeof entry[key], 'number')
    }
  }
})

test('a nested column is named by its dotted path', () => {
  const summary = parquetColumnSummary(metadataFrom([[
    chunk(['a', 'list', 'element'], { values: 7n, compressed: 1n, uncompressed: 2n, nulls: 1n }),
  ]]))
  assert.equal(summary.length, 1)
  assert.equal(summary[0].name, 'a.list.element')
})

test('values and sizes are summed across row groups', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [
      chunk(['x'], { values: 5n, compressed: 10n, uncompressed: 20n, nulls: 1n }),
      chunk(['y'], { type: 'DOUBLE', values: 5n, compressed: 30n, uncompressed: 40n, nulls: 0n }),
    ],
    [
      chunk(['x'], { values: 3n, compressed: 7n, uncompressed: 9n, nulls: 2n }),
      chunk(['y'], { type: 'DOUBLE', values: 3n, compressed: 11n, uncompressed: 13n, nulls: 0n }),
    ],
    [
      chunk(['x'], { values: 1n, compressed: 100n, uncompressed: 200n, nulls: 0n }),
      chunk(['y'], { type: 'DOUBLE', values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
    ],
  ]))
  assert.deepEqual(summary, [
    { name: 'x', type: 'INT32', numValues: 9, nullCount: 3, compressedBytes: 117, uncompressedBytes: 229 },
    { name: 'y', type: 'DOUBLE', numValues: 9, nullCount: 0, compressedBytes: 42, uncompressedBytes: 54 },
  ])
})

test('the null count is null when any chunk lacks it', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [
      chunk(['p'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 2n }),
      chunk(['q'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 'none' }),
      chunk(['r'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
    ],
    [
      chunk(['p'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 'nostats' }),
      chunk(['q'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 3n }),
      chunk(['r'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
    ],
  ]))
  assert.deepEqual(summary.map(entry => [entry.name, entry.nullCount]), [['p', null], ['q', null], ['r', 0]])
  assert.deepEqual(summary.map(entry => entry.numValues), [2, 2, 2])
})

test('columns appear in order of first appearance and merge by name', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [
      chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
      chunk(['b'], { values: 1n, compressed: 2n, uncompressed: 2n, nulls: 0n }),
    ],
    [
      chunk(['c'], { values: 4n, compressed: 5n, uncompressed: 6n, nulls: 1n }),
      chunk(['a'], { values: 2n, compressed: 3n, uncompressed: 3n, nulls: 1n }),
    ],
  ]))
  assert.deepEqual(summary, [
    { name: 'a', type: 'INT32', numValues: 3, nullCount: 1, compressedBytes: 4, uncompressedBytes: 4 },
    { name: 'b', type: 'INT32', numValues: 1, nullCount: 0, compressedBytes: 2, uncompressedBytes: 2 },
    { name: 'c', type: 'INT32', numValues: 4, nullCount: 1, compressedBytes: 5, uncompressedBytes: 6 },
  ])
})

test('the metadata is not modified', () => {
  const metadata = metadataFrom([
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 1n })],
    [chunk(['a'], { values: 2n, compressed: 2n, uncompressed: 2n, nulls: 2n })],
  ])
  const text = () => JSON.stringify(metadata, (_k, v) => typeof v === 'bigint' ? `${v}n` : v)
  const before = text()
  parquetColumnSummary(metadata)
  parquetColumnSummary(metadata)
  assert.equal(text(), before)
})

test('a file with two row groups', () => {
  const metadata = metadataOf('bloom_filter.parquet')
  const [first, second] = metadata.row_groups.map(group => /** @type {any} */ (group.columns[0].meta_data))
  assert.deepEqual(parquetColumnSummary(metadata), [{
    name: 'code',
    type: 'INT32',
    numValues: 4096,
    nullCount: 0,
    compressedBytes: Number(first.total_compressed_size + second.total_compressed_size),
    uncompressedBytes: Number(first.total_uncompressed_size + second.total_uncompressed_size),
  }])
})

test('a file with nested columns', () => {
  const summary = parquetColumnSummary(metadataOf('nullable.impala.parquet'))
  assert.equal(summary.length, 13)
  const byName = Object.fromEntries(summary.map(entry => [entry.name, entry]))
  const deep = byName['nested_struct.C.d.list.element.list.element.F']
  assert.deepEqual([byName.id.type, byName.id.numValues, byName.id.nullCount], ['INT64', 7, 0])
  assert.deepEqual(
    [byName['int_array.list.element'].numValues, byName['int_array.list.element'].nullCount],
    [14, 8]
  )
  assert.deepEqual([deep.type, deep.numValues, deep.nullCount], ['BYTE_ARRAY', 19, 13])
  assert.equal(summary[0].name, 'id')
  assert.equal(summary[12].name, 'nested_struct.g.map.value.H.i.list.element')
})

test('a column without statistics has a null count of null', () => {
  const summary = parquetColumnSummary(metadataOf('byte_array_decimal.parquet'))
  assert.equal(summary.length, 1)
  assert.equal(summary[0].name, 'value')
  assert.equal(summary[0].numValues, 24)
  assert.equal(summary[0].nullCount, null)
})
