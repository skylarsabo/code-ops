import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetRead } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('onChunk reports half-open row ranges that match the chunk length', async () => {
  const chunks = []
  await parquetRead({
    file: load('dictionary_offset_indexed.parquet'),
    onChunk: chunk => chunks.push(chunk),
  })
  assert.deepEqual(chunks.map(c => c.columnName).sort(), ['country', 'id'])
  for (const chunk of chunks) {
    assert.equal(chunk.rowStart, 0)
    assert.equal(chunk.rowEnd - chunk.rowStart, chunk.columnData.length)
    assert.equal(chunk.rowEnd, 200)
  }
})

test('onChunk ranges for the second row group continue from the first', async () => {
  const chunks = []
  await parquetRead({
    file: load('bloom_filter.parquet'),
    onChunk: chunk => chunks.push(chunk),
  })
  chunks.sort((a, b) => a.rowStart - b.rowStart)
  assert.deepEqual(chunks.map(c => [c.rowStart, c.rowEnd]), [[0, 2048], [2048, 4096]])
})
