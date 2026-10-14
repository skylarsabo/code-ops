import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetRead } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('a failed column read rejects a read that has no callbacks', async () => {
  const buf = load('datapage_v2.snappy.parquet')
  const metadata = parquetMetadata(buf)
  const failing = {
    byteLength: buf.byteLength,
    slice() { return Promise.reject(new Error('storage read failed')) },
  }
  await assert.rejects(parquetRead({ file: failing, metadata }), /storage read failed/)
})

test('a healthy read without callbacks resolves', async () => {
  const buf = load('datapage_v2.snappy.parquet')
  const metadata = parquetMetadata(buf)
  await parquetRead({ file: buf, metadata })
})
