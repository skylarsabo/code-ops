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

test('a filtered query keeps reading row groups until rowEnd rows are matched', async () => {
  const file = load('bloom_filter.parquet')
  const filter = { code: { $gte: 10 } }

  const head = await parquetQuery({ file, filter, rowEnd: 3000 })
  assert.equal(head.length, 3000)
  assert.deepEqual(head.slice(0, 4).map(row => row.code), [10, 90, 10, 90])
  assert.equal(head[2048].code, 30)

  const window = await parquetQuery({ file, filter, rowStart: 100, rowEnd: 2100 })
  assert.equal(window.length, 2000)
  assert.equal(window[1948].code, 30)
})
