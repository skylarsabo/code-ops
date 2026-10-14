import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedAsyncBuffer } from '../src/index.js'

test('a small file is fetched once and sliced from the cached bytes', async () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i)
  const calls = []
  const inner = {
    byteLength: 16,
    slice: async (start, end) => {
      calls.push([start, end])
      return bytes.buffer.slice(start, end)
    },
  }
  const cached = cachedAsyncBuffer(inner)
  const first = await cached.slice(2, 6)
  const second = await cached.slice(0, 4)
  assert.deepEqual(Array.from(new Uint8Array(first)), [2, 3, 4, 5])
  assert.deepEqual(Array.from(new Uint8Array(second)), [0, 1, 2, 3])
  assert.equal(calls.length, 1)
})
