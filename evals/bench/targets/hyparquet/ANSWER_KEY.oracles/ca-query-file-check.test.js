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

test('parquetQuery refuses anything that is not an AsyncBuffer', async () => {
  await assert.rejects(parquetQuery({}), /expected AsyncBuffer/)
  await assert.rejects(parquetQuery({ file: null }), /expected AsyncBuffer/)
  await assert.rejects(parquetQuery({ file: {} }), /expected AsyncBuffer/)
  await assert.rejects(parquetQuery({ file: { byteLength: -1 } }), /expected AsyncBuffer/)
  await assert.rejects(parquetQuery({ file: 'dictionary_offset_indexed.parquet' }), /expected AsyncBuffer/)
})

test('parquetQuery reads from a valid AsyncBuffer', async () => {
  const rows = await parquetQuery({ file: load('dictionary_offset_indexed.parquet'), rowStart: 0, rowEnd: 2 })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].country, 'Canada')
})
