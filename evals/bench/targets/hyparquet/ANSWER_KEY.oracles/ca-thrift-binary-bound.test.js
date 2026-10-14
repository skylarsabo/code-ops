import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deserializeTCompactProtocol } from '../src/thrift.js'

// An 8-byte view over a larger buffer: bytes past the view belong to someone else.
function viewOverLargerBuffer(bytes) {
  const backing = new ArrayBuffer(64)
  const raw = new Uint8Array(backing)
  raw.fill(0xaa)
  raw.set(bytes)
  return new DataView(backing, 0, 8)
}

test('a binary field longer than the rest of the view is refused', () => {
  const view = viewOverLargerBuffer([0x18, 0x07, 1, 2, 3, 4, 5, 6])
  assert.throws(() => deserializeTCompactProtocol({ view, offset: 0 }), /exceeds remaining/)
})

test('a binary field that fits the view is returned', () => {
  const view = viewOverLargerBuffer([0x18, 0x05, 1, 2, 3, 4, 5, 0x00])
  const parsed = deserializeTCompactProtocol({ view, offset: 0 })
  assert.deepEqual(Array.from(parsed.field_1), [1, 2, 3, 4, 5])
})
