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

test('metadata that overflows the initial fetch by less than the footer is still read whole', async () => {
  const buf = load('bloom_filter.parquet')
  const metadataLength = new DataView(buf).getUint32(buf.byteLength - 8, true)
  const file = {
    byteLength: buf.byteLength,
    slice: (start, end) => Promise.resolve(buf.slice(start, end)),
  }
  // The initial fetch holds the footer and all but a few bytes of the metadata.
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: metadataLength + 4 })
  assert.equal(canonical(metadata), canonical(parquetMetadata(buf)))
})

test('metadata that fits the initial fetch is read from one request', async () => {
  const buf = load('bloom_filter.parquet')
  const calls = []
  const file = {
    byteLength: buf.byteLength,
    slice: (start, end) => { calls.push([start, end]); return Promise.resolve(buf.slice(start, end)) },
  }
  const metadata = await parquetMetadataAsync(file)
  assert.equal(calls.length, 1)
  assert.equal(canonical(metadata), canonical(parquetMetadata(buf)))
})
