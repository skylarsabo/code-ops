import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRleBitPackedHybrid } from '../src/encoding.js'

/** @param {number[]} bytes */
const readerOf = bytes => ({ view: new DataView(new Uint8Array(bytes).buffer), offset: 0 })

test('a run of width 8 stores its value in one byte', () => {
  // header 0x06 is a run of three, then the value 0x2a.
  const reader = readerOf([0x06, 0x2a, 0x08, 0x07])
  const output = new Array(3)
  readRleBitPackedHybrid(reader, 8, output, 2)
  assert.deepEqual(output, [42, 42, 42])
  assert.equal(reader.offset, 2)
})

test('a run of width 9 stores its value in two little-endian bytes', () => {
  const reader = readerOf([0x04, 0x2c, 0x01])
  const output = new Array(2)
  readRleBitPackedHybrid(reader, 9, output, 3)
  assert.deepEqual(output, [300, 300])
})

test('a run of width 16 stores its value in two bytes and a run of width 1 in one', () => {
  const wide = new Array(2)
  readRleBitPackedHybrid(readerOf([0x04, 0x34, 0x12]), 16, wide, 3)
  assert.deepEqual(wide, [0x1234, 0x1234])
  const narrow = new Array(4)
  readRleBitPackedHybrid(readerOf([0x08, 0x01]), 1, narrow, 2)
  assert.deepEqual(narrow, [1, 1, 1, 1])
})
