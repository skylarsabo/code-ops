// Acceptance test for parquetColumnSummary and parquetColumnSummaryAsync.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetColumnSummary, parquetColumnSummaryAsync, parquetMetadata } from '../src/index.js'

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
 * @param {{ type?: string, values: bigint | number, compressed: bigint | number, uncompressed: bigint | number, nulls?: bigint | number | 'none' | 'nostats', encodings?: string[], codec?: string }} spec
 */
function chunk(path, { type = 'INT32', values, compressed, uncompressed, nulls = 'nostats', encodings = ['PLAIN'], codec = 'SNAPPY' }) {
  /** @type {any} */
  const meta_data = {
    type,
    encodings,
    codec,
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
    { name: 'id', type: 'INT64', numValues: 10, nullCount: 0, compressedBytes: 100, uncompressedBytes: 160, chunks: 1, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
    { name: 'name', type: 'BYTE_ARRAY', numValues: 10, nullCount: 4, compressedBytes: 50, uncompressedBytes: 70, chunks: 1, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
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
    { name: 'x', type: 'INT32', numValues: 9, nullCount: 3, compressedBytes: 117, uncompressedBytes: 229, chunks: 3, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
    { name: 'y', type: 'DOUBLE', numValues: 9, nullCount: 0, compressedBytes: 42, uncompressedBytes: 54, chunks: 3, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
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
    { name: 'a', type: 'INT32', numValues: 3, nullCount: 1, compressedBytes: 4, uncompressedBytes: 4, chunks: 2, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
    { name: 'b', type: 'INT32', numValues: 1, nullCount: 0, compressedBytes: 2, uncompressedBytes: 2, chunks: 1, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
    { name: 'c', type: 'INT32', numValues: 4, nullCount: 1, compressedBytes: 5, uncompressedBytes: 6, chunks: 1, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
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
    chunks: 2,
    encodings: sortedUnique([...first.encodings, ...second.encodings]),
    codecs: sortedUnique([first.codec, second.codec]),
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

/** A file source whose slice returns a promise. */
function asyncFile(/** @type {string} */ name) {
  const buf = readFileSync(join(dataDir, name))
  const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return { byteLength: buffer.byteLength, slice: async (/** @type {number} */ start, /** @type {number | undefined} */ end) => buffer.slice(start, end) }
}

/** @param {string[]} values */
function sortedUnique(values) {
  return [...new Set(values)].sort()
}

test('chunks counts the row groups that hold the column', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }), chunk(['b'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n })],
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n })],
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }), chunk(['b'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n })],
  ]))
  assert.deepEqual(summary.map(entry => [entry.name, entry.chunks]), [['a', 3], ['b', 2]])
})

test('encodings and codecs are the distinct values sorted alphabetically', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n, encodings: ['RLE', 'PLAIN'], codec: 'SNAPPY' })],
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n, encodings: ['PLAIN_DICTIONARY', 'RLE'], codec: 'UNCOMPRESSED' })],
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n, encodings: [], codec: 'SNAPPY' })],
  ]))
  assert.deepEqual(summary[0].encodings, ['PLAIN', 'PLAIN_DICTIONARY', 'RLE'])
  assert.deepEqual(summary[0].codecs, ['SNAPPY', 'UNCOMPRESSED'])
})

test('the type comes from the first chunk of the column', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [chunk(['a'], { type: 'INT32', values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n })],
    [chunk(['a'], { type: 'INT64', values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n })],
  ]))
  assert.equal(summary[0].type, 'INT32')
})

test('a chunk without meta_data is ignored', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [
      { file_offset: 5n },
      chunk(['a'], { values: 2n, compressed: 3n, uncompressed: 4n, nulls: 1n }),
    ],
    [
      chunk(['a'], { values: 5n, compressed: 6n, uncompressed: 7n, nulls: 2n }),
      { file_offset: 9n },
    ],
  ]))
  assert.deepEqual(summary, [
    { name: 'a', type: 'INT32', numValues: 7, nullCount: 3, compressedBytes: 9, uncompressedBytes: 11, chunks: 2, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
  ])
})

test('counts given as numbers are summed like bigint counts', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [chunk(['a'], { values: 4, compressed: 5, uncompressed: 6, nulls: 1 })],
    [chunk(['a'], { values: 4n, compressed: 5n, uncompressed: 6n, nulls: 2n })],
  ]))
  assert.deepEqual(
    [summary[0].numValues, summary[0].nullCount, summary[0].compressedBytes, summary[0].uncompressedBytes],
    [8, 3, 10, 12]
  )
})

test('the columns option keeps the listed top-level columns in order of first appearance', () => {
  const metadata = metadataFrom([
    [
      chunk(['a', 'list', 'element'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
      chunk(['b'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
      chunk(['c', 'x'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
      chunk(['c', 'y'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
    ],
  ])
  const names = (/** @type {string[] | undefined} */ columns) => parquetColumnSummary(metadata, { columns }).map(entry => entry.name)
  assert.deepEqual(names(['c', 'a']), ['a.list.element', 'c.x', 'c.y'])
  assert.deepEqual(names(['b']), ['b'])
  assert.deepEqual(names(undefined), ['a.list.element', 'b', 'c.x', 'c.y'])
  assert.deepEqual(parquetColumnSummary(metadata, {}).length, 4)
})

test('the columns option ignores unknown names, dotted names, and an empty list', () => {
  const metadata = metadataFrom([
    [
      chunk(['a', 'list', 'element'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
      chunk(['b'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n }),
    ],
  ])
  assert.deepEqual(parquetColumnSummary(metadata, { columns: [] }), [])
  assert.deepEqual(parquetColumnSummary(metadata, { columns: ['zzz'] }), [])
  assert.deepEqual(parquetColumnSummary(metadata, { columns: ['a.list.element'] }), [])
  assert.deepEqual(parquetColumnSummary(metadata, { columns: ['zzz', 'b'] }).map(entry => entry.name), ['b'])
})

test('the columns option sums only the kept chunks', () => {
  const summary = parquetColumnSummary(metadataFrom([
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 'nostats' }), chunk(['b'], { values: 2n, compressed: 2n, uncompressed: 2n, nulls: 0n })],
  ]), { columns: ['b'] })
  assert.deepEqual(summary, [
    { name: 'b', type: 'INT32', numValues: 2, nullCount: 0, compressedBytes: 2, uncompressedBytes: 2, chunks: 1, encodings: ['PLAIN'], codecs: ['SNAPPY'] },
  ])
})

test('changing the result never changes the metadata', () => {
  const metadata = metadataFrom([
    [chunk(['a'], { values: 1n, compressed: 1n, uncompressed: 1n, nulls: 0n, encodings: ['RLE'] })],
  ])
  const text = () => JSON.stringify(metadata, (_k, v) => typeof v === 'bigint' ? `${v}n` : v)
  const before = text()
  const first = parquetColumnSummary(metadata)
  first[0].encodings.push('DELTA_BINARY_PACKED')
  first[0].codecs.length = 0
  first[0].name = 'changed'
  first.length = 0
  assert.equal(text(), before)
  assert.deepEqual(parquetColumnSummary(metadata)[0].encodings, ['RLE'])
  assert.deepEqual(parquetColumnSummary(metadata)[0].codecs, ['SNAPPY'])
})

test('a file reports its encodings, codecs, and chunk counts', () => {
  const metadata = metadataOf('bloom_filter.parquet')
  const chunks = metadata.row_groups.map(group => /** @type {any} */ (group.columns[0].meta_data))
  const [entry] = parquetColumnSummary(metadata)
  assert.equal(entry.chunks, 2)
  assert.deepEqual(entry.encodings, sortedUnique(chunks.flatMap(c => c.encodings)))
  assert.deepEqual(entry.codecs, sortedUnique(chunks.map(c => c.codec)))
  const nested = parquetColumnSummary(metadataOf('nullable.impala.parquet'))
  assert.ok(nested.every(item => item.chunks === 1 && item.codecs.length === 1 && item.encodings.length >= 1))
  assert.deepEqual(nested.map(item => item.encodings), nested.map(item => [...item.encodings].sort()))
})

test('parquetColumnSummaryAsync summarizes a file read through promises', async () => {
  const expected = parquetColumnSummary(metadataOf('nullable.impala.parquet'))
  assert.deepEqual(await parquetColumnSummaryAsync({ file: asyncFile('nullable.impala.parquet') }), expected)
  const small = await parquetColumnSummaryAsync({ file: asyncFile('nullable.impala.parquet'), initialFetchSize: 64 })
  assert.deepEqual(small, expected)
})

test('parquetColumnSummaryAsync accepts the columns option', async () => {
  const file = asyncFile('nullable.impala.parquet')
  const expected = parquetColumnSummary(metadataOf('nullable.impala.parquet'), { columns: ['id', 'int_array'] })
  assert.deepEqual(expected.map(entry => entry.name), ['id', 'int_array.list.element'])
  assert.deepEqual(await parquetColumnSummaryAsync({ file, columns: ['int_array', 'id'] }), expected)
  assert.deepEqual(await parquetColumnSummaryAsync({ file, columns: [] }), [])
})

test('parquetColumnSummaryAsync rejects a value that is not a file', async () => {
  await assert.rejects(parquetColumnSummaryAsync(/** @type {any} */ ({ file: {} })), Error)
})
