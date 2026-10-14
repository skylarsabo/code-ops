import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSkipRowGroup } from '../src/filter.js'

function run(filter) {
  const statistics = { min_value: 'b', max_value: 'd', null_count: 0 }
  const rowGroup = { columns: [{ meta_data: { statistics } }] }
  const schemaElements = { x: { name: 'x', type: 'BYTE_ARRAY' } }
  return canSkipRowGroup({ rowGroup, physicalColumns: ['x'], filter, schemaElements })
}

test('relational pruning on string bounds applies only to ASCII targets', () => {
  assert.equal(run({ x: { $gt: 'z' } }), true)
  assert.equal(run({ x: { $gt: '\x7f' } }), true)
  assert.equal(run({ x: { $lt: 'a' } }), true)
  assert.equal(run({ x: { $gt: '\x80' } }), false)
  assert.equal(run({ x: { $gt: 'é' } }), false)
  assert.equal(run({ x: { $lt: 'é' } }), false)
  assert.equal(run({ x: { $gt: 'c' } }), false)
})
