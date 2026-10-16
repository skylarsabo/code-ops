import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata } from '../src/index.js'
import { readBloomFilter } from '../src/bloom.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {number[]} bytes */
const readerOf = bytes => ({ view: new DataView(new Uint8Array(bytes).buffer), offset: 0 })

// Compact protocol: 0x15 opens field 1 as an i32, the next byte is its zigzag value, 0x00 stops.

test('a bloom filter header with no bytes is not usable', () => {
  assert.equal(readBloomFilter(readerOf([0x15, 0x00, 0x00])), undefined)
})

test('a bloom filter header with a negative size is not usable', () => {
  assert.equal(readBloomFilter(readerOf([0x15, 0x01, 0x00])), undefined)
})

test('a bloom filter header whose size is not a whole block is not usable', () => {
  assert.equal(readBloomFilter(readerOf([0x15, 0x20, 0x00])), undefined)
  assert.equal(readBloomFilter(readerOf([0x15, 0x42, 0x00])), undefined)
})

test('a one-block bloom filter from a real file parses', () => {
  const buf = readFileSync(join(dataDir, 'bloom_filter.parquet'))
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const meta = parquetMetadata(file).row_groups[0].columns[0].meta_data
  assert.ok(meta?.bloom_filter_offset && meta.bloom_filter_length)
  const start = Number(meta.bloom_filter_offset)
  const bloom = readBloomFilter({ view: new DataView(file.slice(start, start + meta.bloom_filter_length)), offset: 0 })
  assert.equal(bloom?.numBytes, 32)
})
