import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetCountNulls, parquetMetadata, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const isMissing = (v) => v === null || v === undefined

test('parquetCountNulls counts missing rows of a nested column, not null leaves', async () => {
  const file = load('nullable.impala')
  const rows = await parquetReadObjects({ file })
  for (const column of ['int_array', 'int_map', 'nested_struct']) {
    const want = rows.filter(r => isMissing(r[column])).length
    assert.equal(await parquetCountNulls({ file, column }), want, column)
  }
  assert.equal(await parquetCountNulls({ file, column: 'int_array' }), 4)
  assert.equal(await parquetCountNulls({ file, column: 'id' }), 0)
})

test('parquetCountNulls counts flat columns, with and without statistics', async () => {
  const file = load('datapage_v2.snappy')
  assert.equal(await parquetCountNulls({ file, column: 'a' }), 1)
  assert.equal(await parquetCountNulls({ file, column: 'b' }), 0)
  assert.equal(await parquetCountNulls({ file, column: 'a', rowStart: 3, rowEnd: 4 }), 1)
  const metadata = structuredClone(parquetMetadata(file))
  for (const column of metadata.row_groups[0].columns) delete column.meta_data.statistics
  assert.equal(await parquetCountNulls({ file, metadata, column: 'a' }), 1)
  assert.equal(await parquetCountNulls({ file, metadata, column: 'e' }), 2)
})
