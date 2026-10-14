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
test('parquetCount counts the rows that match a filter', async () => {
  const file = load('bloom_filter')
  const rows = await parquetReadObjects({ file })
  const matching = (pred, start = 0, end = rows.length) => rows.slice(start, end).filter(pred).length
  assert.equal(await parquetCount({ file, filter: { code: 10 } }), matching(r => r.code === 10))
  assert.equal(await parquetCount({ file, filter: { code: { $gte: 70 } } }), matching(r => r.code >= 70))
  assert.equal(
    await parquetCount({ file, filter: { code: 10 }, rowStart: 2040, rowEnd: 2060 }),
    matching(r => r.code === 10, 2040, 2060)
  )
  assert.equal(
    await parquetCount({ file, filter: { code: { $in: [10, 90] } }, rowStart: 500, rowEnd: 3500 }),
    matching(r => r.code === 10 || r.code === 90, 500, 3500)
  )
})
