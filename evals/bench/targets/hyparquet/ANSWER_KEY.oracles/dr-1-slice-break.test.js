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
test('parquetCount windows that end on a row group boundary', async () => {
  const file = load('bloom_filter')
  const rows = await parquetReadObjects({ file })
  const filters = [
    [{ code: 10 }, r => r.code === 10],
    [{ code: { $gte: 70 } }, r => r.code >= 70],
  ]
  const windows = [[0, 2048], [2000, 2048], [100, 2048], [0, 4096], [2048, 4096], [1000, 3000], [2047, 2049], [2048, 2049]]
  for (const [filter, pred] of filters) {
    for (const [start, end] of windows) {
      const want = rows.slice(start, end).filter(pred).length
      assert.equal(await parquetCount({ file, filter, rowStart: start, rowEnd: end }), want, JSON.stringify({ filter, start, end }))
    }
  }
})
