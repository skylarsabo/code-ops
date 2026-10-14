import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetCount, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
test('parquetCount rejects a missing file and a negative rowStart', async () => {
  const file = load('bloom_filter')
  await assert.rejects(() => parquetCount({}), /expected AsyncBuffer/)
  await assert.rejects(() => parquetCount({ file: {} }), /expected AsyncBuffer/)
  await assert.rejects(() => parquetCount({ file, rowStart: -1 }), /rowStart must be positive/)
  assert.equal(await parquetCount({ file, rowStart: 0, rowEnd: 0 }), 0)
  assert.equal(await parquetCount({ file, rowStart: 7, rowEnd: 7, filter: { code: 10 } }), 0)
  assert.equal(await parquetCount({ file, rowStart: 2048, rowEnd: 2048, filter: { code: 90 } }), 0)
  assert.equal(await parquetCount({ file, filter: { code: 10 }, rowStart: 4096, rowEnd: 4096 }), 0)
})
