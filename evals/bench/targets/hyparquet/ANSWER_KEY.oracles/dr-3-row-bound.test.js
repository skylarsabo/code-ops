import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetQuery } from '../src/index.js'
import { groupsHolding, locateRow } from '../src/locate.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
test('locateRow maps rows to row groups and rejects rows outside the file', () => {
  const metadata = parquetMetadata(load('bloom_filter'))
  assert.deepEqual(locateRow(metadata, 0), { group: 0, offset: 0 })
  assert.deepEqual(locateRow(metadata, 2047), { group: 0, offset: 2047 })
  assert.deepEqual(locateRow(metadata, 2048), { group: 1, offset: 0 })
  assert.deepEqual(locateRow(metadata, 4095), { group: 1, offset: 2047 })
  for (const row of [4096, 4097, 99999, -1, 1.5, NaN, Infinity]) {
    assert.equal(locateRow(metadata, row), undefined, String(row))
  }
})
