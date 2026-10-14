import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetMetadataAsync } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const canonical = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? `${v}n` : v)

test('the metadata beyond the initial fetch is awaited before it is combined', async () => {
  const buf = load('bloom_filter.parquet')
  const file = {
    byteLength: buf.byteLength,
    slice: (start, end) => new Promise(resolve => setTimeout(() => resolve(buf.slice(start, end)), 5)),
  }
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: 16 })
  assert.equal(canonical(metadata), canonical(parquetMetadata(buf)))
})
