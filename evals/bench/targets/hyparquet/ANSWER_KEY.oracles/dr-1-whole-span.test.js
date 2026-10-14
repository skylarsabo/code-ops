import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetCountNulls, parquetMetadata } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('parquetCountNulls trusts statistics only for row groups wholly inside the range', async () => {
  const file = load('bloom_filter')
  // Report a null count the data does not hold, so a count taken from statistics shows.
  const metadata = structuredClone(parquetMetadata(file))
  metadata.row_groups[0].columns[0].meta_data.statistics.null_count = 7n
  metadata.row_groups[1].columns[0].meta_data.statistics.null_count = 11n
  const count = (rowStart, rowEnd) => parquetCountNulls({ file, metadata, column: 'code', rowStart, rowEnd })
  assert.equal(await count(0, 4096), 18)
  assert.equal(await count(0, 2048), 7)
  assert.equal(await count(2048, 4096), 11)
  assert.equal(await count(0, 3000), 7)
  assert.equal(await count(100, 4096), 11)
  assert.equal(await count(0, 1000), 0)
  assert.equal(await count(1, 2048), 0)
  assert.equal(await count(2047, 2049), 0)
  assert.equal(await count(2048, 4095), 0)
})
