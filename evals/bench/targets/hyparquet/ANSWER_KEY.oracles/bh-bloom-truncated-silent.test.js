import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata } from '../src/index.js'
import { readBloomFilter } from '../src/bloom.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** The serialized bloom filter of the first column of row group zero. */
function bloomBytes() {
  const file = load('bloom_filter.parquet')
  const meta = parquetMetadata(file).row_groups[0].columns[0].meta_data
  assert.ok(meta?.bloom_filter_offset && meta.bloom_filter_length)
  const start = Number(meta.bloom_filter_offset)
  return file.slice(start, start + meta.bloom_filter_length)
}

test('a complete bloom filter parses', () => {
  const bloom = readBloomFilter({ view: new DataView(bloomBytes()), offset: 0 })
  assert.equal(bloom?.numBytes, 32)
  assert.equal(bloom?.blocks.length, 8)
})

test('a bloom filter cut short reports the truncation', () => {
  const bytes = bloomBytes()
  const cut = bytes.slice(0, bytes.byteLength - 8)
  assert.throws(() => readBloomFilter({ view: new DataView(cut), offset: 0 }), /bloom filter truncated/)
})
