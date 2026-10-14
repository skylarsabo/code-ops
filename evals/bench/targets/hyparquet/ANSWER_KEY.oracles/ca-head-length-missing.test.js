import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteLengthFromUrl } from '../src/index.js'

function response(status, headers) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers) }
}

test('a HEAD response with a content length is the whole answer', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push(init.method ?? 'GET')
    if (init.method === 'HEAD') return response(200, { 'Content-Length': '123' })
    throw new Error('unexpected ranged request')
  }
  assert.equal(await byteLengthFromUrl('https://example.test/f.parquet', undefined, fetchFn), 123)
  assert.deepEqual(calls, ['HEAD'])
})

test('a HEAD response without a content length falls back to a ranged GET', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push(init.method ?? 'GET')
    if (init.method === 'HEAD') return response(200, {})
    return response(206, { 'Content-Range': 'bytes 0-0/456' })
  }
  assert.equal(await byteLengthFromUrl('https://example.test/f.parquet', undefined, fetchFn), 456)
  assert.deepEqual(calls, ['HEAD', 'GET'])
})
