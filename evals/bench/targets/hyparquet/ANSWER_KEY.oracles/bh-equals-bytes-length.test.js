import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchFilter } from '../src/filter.js'
import { equals } from '../src/utils.js'

test('byte arrays of different length are never equal', () => {
  const short = new Uint8Array([1, 2])
  const long = new Uint8Array([1, 2, 3])
  assert.equal(equals(short, long), false)
  assert.equal(equals(long, short), false)
  assert.equal(equals(new Uint8Array(0), new Uint8Array([0])), false)
})

test('byte arrays of the same length compare by content', () => {
  assert.equal(equals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true)
  assert.equal(equals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false)
})

test('filters on binary columns use the same length rule', () => {
  const record = { blob: new Uint8Array([1, 2]) }
  assert.equal(matchFilter(record, { blob: { $eq: new Uint8Array([1, 2, 3]) } }), false)
  assert.equal(matchFilter(record, { blob: { $ne: new Uint8Array([1, 2, 3]) } }), true)
  assert.equal(matchFilter(record, { blob: { $eq: new Uint8Array([1, 2]) } }), true)
})
