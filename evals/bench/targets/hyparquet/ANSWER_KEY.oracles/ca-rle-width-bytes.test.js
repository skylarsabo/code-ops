import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRleBitPackedHybrid } from '../src/encoding.js'

// One RLE run of `count` copies of `value`, stored in ceil(width / 8) bytes, then a
// byte that belongs to whatever follows the run.
function run(width, count, value) {
  const bytes = [count << 1]
  for (let i = 0; i < Math.ceil(width / 8); i++) bytes.push(value >> 8 * i & 0xff)
  const length = bytes.length
  bytes.push(0xcd, 0xcd)
  return { bytes: Uint8Array.from(bytes), length }
}

test('an RLE run stores its value in the smallest whole number of bytes', () => {
  for (const [width, value] of [[1, 1], [7, 0x55], [8, 0xab], [9, 0x1ab], [16, 0xbeef], [17, 0x1beef]]) {
    const { bytes, length } = run(width, 5, value)
    const reader = { view: new DataView(bytes.buffer), offset: 0 }
    const output = new Array(5)
    readRleBitPackedHybrid(reader, width, output, length)
    assert.deepEqual(output, [value, value, value, value, value], `width ${width}`)
    assert.equal(reader.offset, length)
  }
})
