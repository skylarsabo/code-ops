import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readZigZag } from '../src/thrift.js'

function read(bytes) {
  const array = Uint8Array.from(bytes)
  return readZigZag({ view: new DataView(array.buffer), offset: 0 })
}

test('small zigzag values decode to their signed form', () => {
  assert.equal(read([0x00]), 0)
  assert.equal(read([0x01]), -1)
  assert.equal(read([0x02]), 1)
  assert.equal(read([0x03]), -2)
})

test('a zigzag value that fills all 32 bits decodes to the extreme int32', () => {
  assert.equal(read([0xff, 0xff, 0xff, 0xff, 0x0f]), -2147483648)
  assert.equal(read([0xfe, 0xff, 0xff, 0xff, 0x0f]), 2147483647)
})
