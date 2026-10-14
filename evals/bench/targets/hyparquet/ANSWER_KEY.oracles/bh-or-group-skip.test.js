import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// Row group one holds 10 and 90 only, so the second branch alone proves the group cannot match it.

test('$or keeps a row group when any branch can match', async () => {
  const rows = await parquetReadObjects({
    file: load('bloom_filter.parquet'),
    filter: { $or: [{ code: 10 }, { code: { $gt: 100 } }] },
  })
  assert.equal(rows.length, 1024)
  assert.ok(rows.every(row => row.code === 10))
})

test('$or across both row groups returns rows from each', async () => {
  const rows = await parquetReadObjects({
    file: load('bloom_filter.parquet'),
    filter: { $or: [{ code: 10 }, { code: 70 }] },
  })
  assert.equal(rows.length, 2048)
  assert.deepEqual([...new Set(rows.map(row => row.code))].sort((a, b) => a - b), [10, 70])
})
