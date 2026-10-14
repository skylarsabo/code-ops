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

test('filters compare without type coercion unless filterStrict is off', async () => {
  const file = load('bloom_filter.parquet')
  assert.deepEqual(await parquetReadObjects({ file, filter: { code: '10' } }), [])
  assert.deepEqual(await parquetReadObjects({ file, filter: { code: { $eq: '10' } } }), [])
  assert.equal((await parquetReadObjects({ file, filter: { code: 10 } })).length, 1024)
})

test('filterStrict false allows loose comparison', async () => {
  const rows = await parquetReadObjects({ file: load('bloom_filter.parquet'), filter: { code: '10' }, filterStrict: false })
  assert.equal(rows.length, 1024)
})
