import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata } from '../src/index.js'
import { prefetchBloomFilters } from '../src/plan.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('every bloom filter is loaded before the prefetch resolves', async () => {
  const buf = load('bloom_filter.parquet')
  const metadata = parquetMetadata(buf)
  const file = {
    byteLength: buf.byteLength,
    slice: (start, end) => new Promise(resolve => setTimeout(() => resolve(buf.slice(start, end)), 10)),
  }
  const result = await prefetchBloomFilters({ file, metadata, filter: { code: { $eq: 30 } } })
  assert.equal(result.length, 2)
  for (const group of result) {
    assert.ok(group.code?.blocks instanceof Uint32Array)
    assert.ok(group.code.numBytes > 0)
  }
})
