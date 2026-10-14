import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('parquetReadObjects rejects when the read fails', async () => {
  const file = load('datapage_v2.snappy.parquet')
  await assert.rejects(parquetReadObjects({ file, columns: ['missing'] }), /column not found: missing/)
  await assert.rejects(parquetReadObjects({ file, filter: { missing: 1 } }), /filter columns not found/)
})

test('parquetReadObjects resolves rows when the read succeeds', async () => {
  const rows = await parquetReadObjects({ file: load('datapage_v2.snappy.parquet'), columns: ['b'] })
  assert.equal(rows.length, 5)
})
