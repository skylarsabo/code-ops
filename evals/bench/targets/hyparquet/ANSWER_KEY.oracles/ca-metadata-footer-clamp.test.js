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

// A strict AsyncBuffer: it serves only ranges that lie inside the file.
function strictFile(buf) {
  return {
    byteLength: buf.byteLength,
    slice: async (start, end) => {
      if (start < 0 || start > end || end > buf.byteLength) throw new Error(`range ${start}-${end} outside file`)
      return buf.slice(start, end)
    },
  }
}

test('a file smaller than the initial fetch is requested from byte zero', async () => {
  const buf = load('bloom_filter.parquet')
  const metadata = await parquetMetadataAsync(strictFile(buf))
  assert.equal(canonical(metadata), canonical(parquetMetadata(buf)))
})

test('an initial fetch equal to the file size is requested from byte zero', async () => {
  const buf = load('bloom_filter.parquet')
  const metadata = await parquetMetadataAsync(strictFile(buf), { initialFetchSize: buf.byteLength })
  assert.equal(canonical(metadata), canonical(parquetMetadata(buf)))
})
