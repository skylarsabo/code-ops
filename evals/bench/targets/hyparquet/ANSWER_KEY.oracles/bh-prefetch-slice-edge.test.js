import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prefetchAsyncBuffer } from '../src/plan.js'

function countingFile() {
  const bytes = new Uint8Array(200).map((_, i) => i)
  /** @type {[number, number][]} */
  const calls = []
  return {
    calls,
    byteLength: 200,
    slice(/** @type {number} */ start, /** @type {number} */ end = 200) {
      calls.push([start, end])
      return Promise.resolve(bytes.slice(start, end).buffer)
    },
  }
}

test('a read inside a prefetched range is served from it', async () => {
  const file = countingFile()
  const buffer = prefetchAsyncBuffer(file, { fetches: [{ startByte: 50, endByte: 100 }] })
  const inner = new Uint8Array(await buffer.slice(60, 80))
  assert.deepEqual(Array.from(inner), Array.from({ length: 20 }, (_, i) => 60 + i))
  assert.deepEqual(file.calls, [[50, 100]])
})

test('a read that ends where the prefetched range ends is served from it', async () => {
  const file = countingFile()
  const buffer = prefetchAsyncBuffer(file, { fetches: [{ startByte: 50, endByte: 100 }] })
  const tail = new Uint8Array(await buffer.slice(90, 100))
  assert.deepEqual(Array.from(tail), Array.from({ length: 10 }, (_, i) => 90 + i))
  assert.deepEqual(file.calls, [[50, 100]])
})

test('a read that runs past the prefetched range goes to the file', async () => {
  const file = countingFile()
  const buffer = prefetchAsyncBuffer(file, { fetches: [{ startByte: 50, endByte: 100 }] })
  await buffer.slice(90, 101)
  assert.deepEqual(file.calls, [[50, 100], [90, 101]])
})
