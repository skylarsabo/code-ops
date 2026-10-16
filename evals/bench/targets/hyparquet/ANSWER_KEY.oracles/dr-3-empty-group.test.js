import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata } from '../src/index.js'
import { groupRanges } from '../src/locate.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** The rows a list of ranges covers, so that two splits of the same rows compare equal. */
function covered(ranges) {
  const rows = new Set()
  for (const [start, end] of ranges) for (let row = start; row < end; row++) rows.add(row)
  return [...rows]
}
const groups = (...sizes) => ({ row_groups: sizes.map(size => ({ num_rows: BigInt(size) })) })

test('groupRanges covers exactly the rows of the flagged groups', () => {
  const metadata = groups(2, 0, 3, 4, 0, 1, 0)
  const expect = (flags, want) => assert.deepEqual(covered(groupRanges(metadata, flags)), want, flags.join())
  expect([true, false, false, false, false, false, false], [0, 1])
  expect([false, false, true, false, false, false, false], [2, 3, 4])
  expect([true, false, true, false, false, true, false], [0, 1, 2, 3, 4, 9])
  expect([false, false, false, true, false, true, false], [5, 6, 7, 8, 9])
  expect([true, false, true, true, false, true, false], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect([false, false, false, false, false, false, false], [])
})

test('groupRanges on a real file keeps ranges sorted and disjoint', () => {
  const metadata = parquetMetadata(load('bloom_filter'))
  assert.deepEqual(covered(groupRanges(metadata, [true, false])), [...Array(2048).keys()])
  assert.deepEqual(covered(groupRanges(metadata, [false, true])), [...Array(2048).keys()].map(i => i + 2048))
  assert.equal(covered(groupRanges(metadata, [true, true])).length, 4096)
  assert.deepEqual(groupRanges(metadata, [false, false]), [])
  const ranges = groupRanges(metadata, [true, true])
  for (const [start, end] of ranges) assert.ok(start < end)
})
