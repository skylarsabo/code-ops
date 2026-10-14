import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashParquetValue } from '../src/bloom.js'

const element = { name: 'code', type: 'INT32' }

test('only whole numbers hash for an INT32 column', () => {
  assert.equal(typeof hashParquetValue(5, element), 'bigint')
  assert.equal(typeof hashParquetValue(-7, element), 'bigint')
  assert.equal(hashParquetValue(5, element), hashParquetValue(5.0, element))
  for (const value of [5.5, '5', 5n, true, null, undefined, NaN, Infinity, {}, [5]]) {
    assert.equal(hashParquetValue(value, element), undefined, String(value))
  }
})

test('INT32 values of a converted type are not hashed', () => {
  assert.equal(hashParquetValue(5, { name: 'd', type: 'INT32', converted_type: 'DATE' }), undefined)
  assert.equal(hashParquetValue(5, { name: 'd', type: 'INT32', logical_type: { type: 'DECIMAL', scale: 0, precision: 4 } }), undefined)
})
