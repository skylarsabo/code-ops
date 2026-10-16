import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSkipRowGroup } from '../src/filter.js'

/** @param {number} max */
const group = max => ({
  columns: [{ meta_data: { statistics: { min_value: 1, max_value: max, null_count: 0n } } }],
})

/**
 * @param {number} max
 * @param {any} condition
 */
const skips = (max, condition) =>
  canSkipRowGroup({ rowGroup: group(max), physicalColumns: ['code'], filter: { code: condition } })

test('a row group whose maximum equals the bound can match $gte', () => {
  assert.equal(skips(5, { $gte: 5 }), false)
})

test('a row group whose maximum is below the bound cannot match $gte', () => {
  assert.equal(skips(4, { $gte: 5 }), true)
})

test('a row group whose maximum equals the bound cannot match $gt', () => {
  assert.equal(skips(5, { $gt: 5 }), true)
  assert.equal(skips(6, { $gt: 5 }), false)
})
