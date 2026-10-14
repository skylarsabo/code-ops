import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deltaLengthByteArray } from '../src/delta.js'

function varint(n) {
  const out = []
  while (n >= 0x80) {
    out.push(n % 128 | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}

const zigzag = n => n >= 0 ? n * 2 : -n * 2 - 1

function pack(values, width) {
  const bytes = new Array(Math.ceil(values.length * width / 8)).fill(0)
  let bit = 0
  for (const value of values) {
    for (let k = 0; k < width; k++, bit++) {
      if (value >> k & 1) bytes[bit >> 3] |= 1 << (bit & 7)
    }
  }
  return bytes
}

// DELTA_BINARY_PACKED for fewer than 33 values: one block, one miniblock.
function encodeDelta(values) {
  const out = [...varint(128), ...varint(4), ...varint(values.length), ...varint(zigzag(values[0]))]
  if (values.length === 1) return out
  const deltas = values.slice(1).map((v, i) => v - values[i])
  const min = Math.min(...deltas)
  const residuals = deltas.map(d => d - min)
  const width = 32 - Math.clz32(Math.max(...residuals))
  while (residuals.length < 32) residuals.push(0)
  return [...out, ...varint(zigzag(min)), width, 0, 0, 0, ...pack(residuals, width)]
}

test('each value is sliced from where the previous one ended', () => {
  const words = ['alpha', 'be', 'gamma', '', 'epsilon']
  const bytes = Uint8Array.from([
    ...encodeDelta(words.map(w => w.length)),
    ...new TextEncoder().encode(words.join('')),
  ])
  const output = new Array(words.length)
  const reader = { view: new DataView(bytes.buffer), offset: 0 }
  deltaLengthByteArray(reader, words.length, output)
  assert.deepEqual(output.map(b => new TextDecoder().decode(b)), words)
  assert.equal(reader.offset, bytes.length)
})
