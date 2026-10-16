import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashParquetValue } from '../src/bloom.js'
import { xxhash64 } from '../src/xxhash.js'

const element = { name: 'n', type: 'INT64', repetition_type: 'REQUIRED' }

test('a negative INT64 hashes as its eight two-complement bytes', () => {
  assert.equal(hashParquetValue(-1n, element), xxhash64(new Uint8Array(8).fill(0xff)))
  assert.equal(hashParquetValue(-2, element), xxhash64(new Uint8Array([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])))
})

test('a positive INT64 hashes as its little-endian bytes and a bigint equals the same number', () => {
  assert.equal(hashParquetValue(258n, element), xxhash64(new Uint8Array([2, 1, 0, 0, 0, 0, 0, 0])))
  assert.equal(hashParquetValue(258, element), hashParquetValue(258n, element))
})

test('an unsafe number cannot be hashed', () => {
  assert.equal(hashParquetValue(2 ** 60, element), undefined)
})
