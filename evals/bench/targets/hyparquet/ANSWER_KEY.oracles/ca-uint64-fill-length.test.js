import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convert, DEFAULT_PARSERS } from '../src/convert.js'

function decoder(repetition_type) {
  return {
    element: { type: 'INT64', converted_type: 'UINT_64', repetition_type },
    parsers: DEFAULT_PARSERS,
  }
}

test('a required unsigned 64-bit column is copied value for value', () => {
  const out = convert([1n, 2n, 3n], decoder('REQUIRED'))
  assert.ok(out instanceof BigUint64Array)
  assert.deepEqual(Array.from(out), [1n, 2n, 3n])
})

test('a nullable unsigned 64-bit column keeps its nulls and its length', () => {
  const out = convert([1n, null, 3n, undefined], decoder('OPTIONAL'))
  assert.equal(out.length, 4)
  assert.deepEqual(Array.from(out), [1n, null, 3n, undefined])
})

test('a signed 64-bit buffer is reinterpreted as unsigned', () => {
  const out = convert(BigInt64Array.of(-1n, 5n), decoder('REQUIRED'))
  assert.deepEqual(Array.from(out), [18446744073709551615n, 5n])
})
