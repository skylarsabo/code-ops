import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deserializeTCompactProtocol } from '../src/thrift.js'

// Field 1 (delta 1) of type LIST, a list of BYTE elements, then STOP.
function listOfBytes(values) {
  const header = values.length < 15
    ? [values.length << 4 | 3]
    : [0xf3, ...(values.length < 128 ? [values.length] : [values.length & 0x7f | 0x80, values.length >> 7])]
  return Uint8Array.from([0x19, ...header, ...values, 0x00])
}

function parse(bytes) {
  return deserializeTCompactProtocol({ view: new DataView(bytes.buffer), offset: 0 })
}

test('lists up to fourteen elements carry their size in the header nibble', () => {
  for (const size of [0, 1, 7, 14]) {
    const values = Array.from({ length: size }, (_, i) => i + 1)
    assert.deepEqual(parse(listOfBytes(values)).field_1, values, `size ${size}`)
  }
})

test('lists of fifteen or more elements carry their size as a following varint', () => {
  for (const size of [15, 16, 127, 200]) {
    const values = Array.from({ length: size }, (_, i) => i % 100)
    assert.deepEqual(parse(listOfBytes(values)).field_1, values, `size ${size}`)
  }
})
