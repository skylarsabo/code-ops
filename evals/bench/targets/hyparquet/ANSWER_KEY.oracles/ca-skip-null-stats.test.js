import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSkipRowGroup } from '../src/filter.js'

function run(statistics, filter) {
  const rowGroup = { columns: [{ meta_data: { statistics } }] }
  return canSkipRowGroup({ rowGroup, physicalColumns: ['x'], filter })
}

test('a row group is kept when its nulls can satisfy the filter', () => {
  assert.equal(run({ min_value: 100, max_value: 100, null_count: 3 }, { x: { $ne: 100 } }), false)
  assert.equal(run({ min_value: 100, max_value: 100 }, { x: { $ne: 100 } }), false)
})

test('a row group is skipped when statistics rule out every value and no null matches', () => {
  assert.equal(run({ min_value: 100, max_value: 100, null_count: 0 }, { x: { $ne: 100 } }), true)
  assert.equal(run({ min_value: 1, max_value: 100, null_count: 3 }, { x: { $gt: 200 } }), true)
  assert.equal(run({ min_value: 1, max_value: 100, null_count: 0 }, { x: { $gt: 50 } }), false)
})
