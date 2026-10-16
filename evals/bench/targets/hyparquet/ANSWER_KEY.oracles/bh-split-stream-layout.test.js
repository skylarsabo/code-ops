import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteStreamSplit } from '../src/encoding.js'

/** @param {number[]} bytes */
const readerOf = bytes => ({ view: new DataView(new Uint8Array(bytes).buffer), offset: 0 })

test('FLOAT values are rebuilt from one stream per byte position', () => {
  // 1.5 is 00 00 C0 3F and -2.25 is 00 00 10 C0, little endian.
  const reader = readerOf([0x00, 0x00, 0x00, 0x00, 0xc0, 0x10, 0x3f, 0xc0])
  assert.deepEqual(Array.from(byteStreamSplit(reader, 2, 'FLOAT', undefined)), [1.5, -2.25])
  assert.equal(reader.offset, 8)
})

test('INT32 values with more values than bytes per value', () => {
  // 1, 2, 3, 258 as little endian words, split by byte position.
  const reader = readerOf([1, 2, 3, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(Array.from(byteStreamSplit(reader, 4, 'INT32', undefined)), [1, 2, 3, 258])
})

test('FIXED_LEN_BYTE_ARRAY values are split by position', () => {
  const reader = readerOf([1, 4, 2, 5, 3, 6])
  const values = byteStreamSplit(reader, 2, 'FIXED_LEN_BYTE_ARRAY', 3)
  assert.deepEqual(Array.from(values, value => Array.from(value)), [[1, 2, 3], [4, 5, 6]])
})
