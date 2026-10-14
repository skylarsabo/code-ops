import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDecimal } from '../src/convert.js'

test('the smallest two-complement value of each width is negative', () => {
  assert.equal(parseDecimal(Uint8Array.of(0x80)), -128)
  assert.equal(parseDecimal(Uint8Array.of(0x80, 0x00)), -32768)
  assert.equal(parseDecimal(Uint8Array.of(0x80, 0x00, 0x00)), -8388608)
})

test('the largest positive value and the next width up stay positive', () => {
  assert.equal(parseDecimal(Uint8Array.of(0x7f)), 127)
  assert.equal(parseDecimal(Uint8Array.of(0x00, 0x80)), 128)
  assert.equal(parseDecimal(Uint8Array.of(0xff)), -1)
  assert.equal(parseDecimal(new Uint8Array(0)), 0)
})
