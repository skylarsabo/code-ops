import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toJson } from '../src/index.js'

test('toJson converts each rich value to a plain JSON form', () => {
  assert.equal(toJson(undefined), null)
  assert.equal(toJson(12n), 12)
  assert.equal(toJson(-0), 0)
  assert.equal(Object.is(toJson(-0), 0), true)
  assert.deepEqual(toJson(new Uint8Array([1, 2, 3])), [1, 2, 3])
  assert.equal(toJson(new Date(86400000)), '1970-01-02T00:00:00.000Z')
  assert.deepEqual(toJson([1n, new Date(0)]), [1, '1970-01-01T00:00:00.000Z'])
})

test('toJson walks objects and drops undefined members', () => {
  const value = {
    bytes: new Uint8Array([9, 8]),
    when: new Date(0),
    big: 10n,
    nested: { list: [1n, undefined, { deep: new Uint8Array([7]) }], gone: undefined },
    text: 'plain',
  }
  assert.deepEqual(toJson(value), {
    bytes: [9, 8],
    when: '1970-01-01T00:00:00.000Z',
    big: 10,
    nested: { list: [1, null, { deep: [7] }] },
    text: 'plain',
  })
})
