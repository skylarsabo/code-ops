import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('parquetQuery returns an empty page when no row is requested', async () => {
  const file = load('bloom_filter')
  for (const options of [{ rowStart: 4096 }, { rowStart: 5000 }, { rowStart: 10, rowEnd: 10 }, { rowEnd: 0 }, { rowStart: 7, rowEnd: 3 }]) {
    assert.deepEqual(await parquetQuery({ file, orderBy: 'code', ...options }), [], JSON.stringify(options))
  }
})

test('parquetQuery pages a sorted result across row groups', async () => {
  const file = load('bloom_filter')
  const all = await parquetReadObjects({ file })
  const order = [...all.keys()].sort((x, y) => all[x].code - all[y].code || x - y)
  const expected = (start, end) => order.slice(start, end).map(i => all[i].code)
  const window = async (rowStart, rowEnd) =>
    (await parquetQuery({ file, orderBy: 'code', columns: ['code'], rowStart, rowEnd })).map(r => r.code)
  assert.deepEqual(await window(0, 5), expected(0, 5))
  assert.deepEqual(await window(2040, 2060), expected(2040, 2060))
  assert.deepEqual(await window(4090, 4200), expected(4090, 4200))
})
