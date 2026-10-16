import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deltaBinaryUnpack } from '../src/delta.js'

/**
 * One block, four miniblocks, every miniblock bit width zero.
 *
 * @param {number} count
 * @param {number[]} minDeltaBytes
 */
function stream(count, minDeltaBytes) {
  return new Uint8Array([
    0x80, 0x01, // block size 128
    0x04, // miniblocks per block
    count,
    0x00, // first value 0
    ...minDeltaBytes,
    0, 0, 0, 0, // miniblock bit widths
  ])
}

test('an int32 delta that needs 33 bits wraps modulo 2^32', () => {
  // zigzag(2^31) is 2^32, which is bit 32 of a five-byte varint.
  const bytes = stream(3, [0x80, 0x80, 0x80, 0x80, 0x10])
  const output = new Int32Array(3)
  deltaBinaryUnpack({ view: new DataView(bytes.buffer), offset: 0 }, 3, output)
  assert.deepEqual(Array.from(output), [0, -2147483648, 0])
})

test('an int32 delta that fits in 32 bits is read as is', () => {
  // zigzag(-3) is 5.
  const bytes = stream(4, [0x05])
  const output = new Int32Array(4)
  deltaBinaryUnpack({ view: new DataView(bytes.buffer), offset: 0 }, 4, output)
  assert.deepEqual(Array.from(output), [0, -3, -6, -9])
})
