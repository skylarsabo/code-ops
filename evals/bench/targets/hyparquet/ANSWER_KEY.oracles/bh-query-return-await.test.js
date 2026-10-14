import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('a plain query returns the requested row range', async () => {
  const rows = await parquetQuery({ file: load('bloom_filter.parquet'), rowStart: 2046, rowEnd: 2050 })
  assert.deepEqual(rows, [{ code: 10 }, { code: 90 }, { code: 30 }, { code: 70 }])
})

test('a plain query rejects for an unknown column', async () => {
  await assert.rejects(
    parquetQuery({ file: load('dictionary_offset_indexed.parquet'), columns: ['missing'] }),
    /parquet column not found: missing/
  )
})

test('a plain query rejects for a file that is not an AsyncBuffer', async () => {
  await assert.rejects(parquetQuery({ file: undefined }), /parquet expected AsyncBuffer/)
})
