import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('an unfiltered, unsorted query returns the requested window', async () => {
  const rows = await parquetQuery({ file: load('dictionary_offset_indexed.parquet'), rowStart: 2, rowEnd: 4 })
  assert.deepEqual(rows.map(row => row.id), [3n, 4n])
})

test('an unfiltered, unsorted query rejects when the read fails', async () => {
  await assert.rejects(
    parquetQuery({ file: load('dictionary_offset_indexed.parquet'), columns: ['missing'] }),
    /column not found: missing/
  )
})
