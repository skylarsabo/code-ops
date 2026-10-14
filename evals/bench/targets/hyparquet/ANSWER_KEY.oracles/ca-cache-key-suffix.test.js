import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedAsyncBuffer } from '../src/index.js'

function countingFile(byteLength) {
  const calls = []
  const bytes = new Uint8Array(byteLength).map((_, i) => i)
  return {
    calls,
    byteLength,
    slice(start, end) {
      calls.push([start, end])
      const from = start < 0 ? byteLength + start : start
      return Promise.resolve(bytes.slice(from, end ?? byteLength).buffer)
    },
  }
}

test('a suffix request and the equivalent absolute request share one cache entry', async () => {
  const file = countingFile(100)
  const cached = cachedAsyncBuffer(file, { minSize: 10 })
  const suffix = await cached.slice(-8)
  const absolute = await cached.slice(92, 100)
  const open = await cached.slice(92)
  assert.equal(file.calls.length, 1)
  assert.deepEqual(Array.from(new Uint8Array(suffix)), [92, 93, 94, 95, 96, 97, 98, 99])
  assert.equal(absolute, suffix)
  assert.equal(open, suffix)
})

test('different ranges are cached separately', async () => {
  const file = countingFile(100)
  const cached = cachedAsyncBuffer(file, { minSize: 10 })
  await cached.slice(-8)
  await cached.slice(-16)
  await cached.slice(0, 8)
  await cached.slice(-8)
  assert.equal(file.calls.length, 3)
})
