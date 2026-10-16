import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetRead } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load() {
  const buf = readFileSync(join(dataDir, 'bloom_filter.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('a read with no callbacks waits for the data and resolves with nothing', async () => {
  const file = load()
  const metadata = parquetMetadata(file)
  let finished = 0
  const slow = {
    byteLength: file.byteLength,
    slice: async (/** @type {number} */ start, /** @type {number | undefined} */ end) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      finished++
      return file.slice(start, end)
    },
  }
  const result = await parquetRead({ file: slow, metadata })
  assert.equal(result, undefined)
  assert.ok(finished > 0)
})

test('a failing column read rejects a read with no callbacks', async () => {
  const file = load()
  const metadata = parquetMetadata(file)
  const failing = {
    byteLength: file.byteLength,
    slice: () => Promise.reject(new Error('disk gone')),
  }
  await assert.rejects(parquetRead({ file: failing, metadata }), /disk gone/)
})
