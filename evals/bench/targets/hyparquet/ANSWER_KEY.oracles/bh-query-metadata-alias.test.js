import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetQuery, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** The first rows of the file in stable sorted order, tagged with their file position. */
async function expectedOrder(file, column, count) {
  const rows = await parquetReadObjects({ file })
  return rows
    .map((row, index) => ({ __index__: index, ...row }))
    .sort((a, b) => a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0)
    .slice(0, count)
}

test('orderBy validates the column and sorts on it', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  await assert.rejects(parquetQuery({ file, orderBy: 'missing' }), /parquet orderBy column not found: missing/)
  assert.deepEqual(await parquetQuery({ file, orderBy: 'country', rowStart: 0, rowEnd: 5 }), await expectedOrder(file, 'country', 5))
})

test('orderBy uses metadata that the caller supplies', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const metadata = parquetMetadata(file)
  await assert.rejects(parquetQuery({ file, metadata, orderBy: 'missing' }), /parquet orderBy column not found: missing/)
  assert.deepEqual(await parquetQuery({ file, metadata, orderBy: 'id', rowStart: 0, rowEnd: 3 }), await expectedOrder(file, 'id', 3))
})
