import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBloomFilter } from '../src/bloom.js'

function varint(value) {
  const out = []
  let rest = value
  while (rest >= 0x80) {
    out.push(rest & 0x7f | 0x80)
    rest >>>= 7
  }
  out.push(rest)
  return out
}

/** A thrift compact BloomFilterHeader followed by numBytes of filter words. */
function bloomImage(numBytes) {
  const variant = [0x1c, 0x1c, 0x00, 0x00]
  const header = [0x15, ...varint(numBytes * 2), ...variant, ...variant, ...variant, 0x00]
  const bytes = new Uint8Array(header.length + numBytes)
  bytes.set(header)
  bytes.fill(0xff, header.length)
  return { view: new DataView(bytes.buffer), offset: 0 }
}

test('a bloom filter whose size is a whole number of 32-byte blocks is read', () => {
  const reader = bloomImage(64)
  const bloom = readBloomFilter(reader)
  assert.equal(bloom?.numBytes, 64)
  assert.equal(bloom?.blocks.length, 16)
  assert.equal(reader.offset, reader.view.byteLength)
})

test('a bloom filter size that is not a multiple of 32 is refused', () => {
  assert.equal(readBloomFilter(bloomImage(48)), undefined)
  assert.equal(readBloomFilter(bloomImage(16)), undefined)
  assert.equal(readBloomFilter(bloomImage(0)), undefined)
})
