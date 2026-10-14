import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asyncBufferFromUrl } from '../src/index.js'

test('ranged reads ask for an inclusive last byte', async () => {
  const ranges = []
  const fakeFetch = async (_url, init) => {
    ranges.push(new Headers(init.headers).get('Range'))
    return { ok: true, status: 206, body: {}, arrayBuffer: async () => new ArrayBuffer(10) }
  }
  const buffer = await asyncBufferFromUrl({ url: 'https://example.test/data.parquet', byteLength: 100, fetch: fakeFetch })
  await buffer.slice(10, 20)
  await buffer.slice(0, 1)
  await buffer.slice(30)
  assert.deepEqual(ranges, ['bytes=10-19', 'bytes=0-0', 'bytes=30-'])
})
