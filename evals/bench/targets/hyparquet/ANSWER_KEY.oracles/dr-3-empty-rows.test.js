import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetQuery } from '../src/index.js'
import { groupsHolding, locateRow } from '../src/locate.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
test('groupsHolding flags the row groups that hold the rows', async () => {
  const file = load('bloom_filter')
  const metadata = parquetMetadata(file)
  assert.deepEqual(groupsHolding(metadata, []), [false, false])
  assert.deepEqual(groupsHolding(metadata, [0]), [true, false])
  assert.deepEqual(groupsHolding(metadata, [3000]), [false, true])
  assert.deepEqual(groupsHolding(metadata, [3000, 5, 99999]), [true, true])
  assert.deepEqual(groupsHolding(metadata, [99999, -5]), [false, false])
  const rows = await parquetQuery({ file, orderBy: 'code' })
  assert.equal(rows.length, 4096)
  const codes = rows.map(r => r.code)
  assert.deepEqual(codes, [...codes].sort((a, b) => a - b))
})
