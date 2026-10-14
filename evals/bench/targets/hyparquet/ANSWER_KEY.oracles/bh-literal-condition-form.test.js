import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchFilter } from '../src/filter.js'

test('a literal condition is an equality test', () => {
  assert.equal(matchFilter({ a: 1 }, { a: 1 }), true)
  assert.equal(matchFilter({ a: 1 }, { a: 2 }), false)
  assert.equal(matchFilter({ a: 'x' }, { a: 'x' }), true)
  assert.equal(matchFilter({ a: 1 }, { a: '1' }), false)
  assert.equal(matchFilter({ a: 1 }, { a: '1' }, false), true)
})

test('a null condition matches missing and null values only', () => {
  assert.equal(matchFilter({ a: null }, { a: null }), true)
  assert.equal(matchFilter({ a: 0 }, { a: null }), false)
  assert.equal(matchFilter({ a: undefined }, { a: null }, false), true)
})

test('an array condition compares whole arrays', () => {
  assert.equal(matchFilter({ a: [1, 2] }, { a: [1, 2] }), true)
  assert.equal(matchFilter({ a: [1, 2] }, { a: [1, 3] }), false)
  assert.equal(matchFilter({ a: [1, 2] }, { a: [1] }), false)
})

test('an object condition applies each operator', () => {
  assert.equal(matchFilter({ a: 5 }, { a: { $gt: 4, $lt: 6 } }), true)
  assert.equal(matchFilter({ a: 5 }, { a: { $gt: 5 } }), false)
  assert.equal(matchFilter({ a: 5 }, { a: { $gte: 5 } }), true)
  assert.equal(matchFilter({ a: 5 }, { a: { $in: [1, 5] } }), true)
  assert.equal(matchFilter({ a: 5 }, { a: { $nin: [1, 5] } }), false)
  assert.equal(matchFilter({ a: { b: 3 } }, { 'a.b': { $eq: 3 } }), true)
  assert.equal(matchFilter({ a: 5 }, { a: { $not: { $lt: 3 } } }), true)
})
