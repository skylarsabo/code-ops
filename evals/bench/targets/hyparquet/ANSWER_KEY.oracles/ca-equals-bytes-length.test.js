import { test } from 'node:test'
import assert from 'node:assert/strict'
import { equals } from '../src/utils.js'

test('byte arrays are equal only when length and content match', () => {
  const bytes = Uint8Array.from([1, 2, 3])
  assert.equal(equals(bytes, Uint8Array.from([1, 2, 3])), true)
  assert.equal(equals(bytes, Uint8Array.from([1, 2])), false)
  assert.equal(equals(bytes, Uint8Array.from([1, 2, 3, 4])), false)
  assert.equal(equals(bytes, Uint8Array.from([1, 2, 4])), false)
  assert.equal(equals(bytes, new Uint8Array(Uint8Array.from([9, 1, 2, 3, 9]).buffer, 1, 3)), true)
  assert.equal(equals(new Uint8Array(0), new Uint8Array(0)), true)
})
