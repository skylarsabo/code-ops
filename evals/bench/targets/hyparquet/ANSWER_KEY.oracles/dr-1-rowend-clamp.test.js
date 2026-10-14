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
test('parquetCount clamps rowEnd to the file', async () => {
  const file = load('bloom_filter')
  assert.equal(await parquetCount({ file }), 4096)
  assert.equal(await parquetCount({ file, rowEnd: 5000 }), 4096)
  assert.equal(await parquetCount({ file, rowStart: 4000, rowEnd: 9000 }), 96)
  assert.equal(await parquetCount({ file, rowStart: 5000 }), 0)
  assert.equal(await parquetCount({ file, rowStart: 10, rowEnd: 20 }), 10)
})
