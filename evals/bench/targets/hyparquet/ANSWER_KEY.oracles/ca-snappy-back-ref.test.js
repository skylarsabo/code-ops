import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snappyUncompress } from '../src/index.js'

test('a copy that reaches before the start of the output is refused', () => {
  const input = new Uint8Array([0x04, 0x01, 0x02])
  assert.throws(() => snappyUncompress(input, new Uint8Array(4)), /before start of buffer/)
})

test('a literal followed by a back reference is expanded', () => {
  const input = new Uint8Array([0x08, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x01, 0x04])
  const output = new Uint8Array(8)
  snappyUncompress(input, output)
  assert.equal(new TextDecoder().decode(output), 'abcdabcd')
})

test('a zero offset is refused', () => {
  const input = new Uint8Array([0x08, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x01, 0x00])
  assert.throws(() => snappyUncompress(input, new Uint8Array(8)), /invalid offset/)
})
