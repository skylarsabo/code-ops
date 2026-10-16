import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parquetPlanGroup } from '../src/plan.js'

/** @param {bigint | undefined} dictionaryOffset */
function fetchFor(dictionaryOffset) {
  const rowGroup = {
    columns: [{
      meta_data: {
        path_in_schema: ['a'],
        dictionary_page_offset: dictionaryOffset,
        data_page_offset: 40n,
        total_compressed_size: 100n,
      },
    }],
    total_byte_size: 100n,
    num_rows: 10n,
  }
  return parquetPlanGroup({ rowGroup, groupStart: 0, groupRows: 10, ranges: [[0, 10]] }).fetches
}

test('a column chunk with no dictionary starts at its first data page', () => {
  assert.deepEqual(fetchFor(undefined), [{ startByte: 40, endByte: 140 }])
})

test('a dictionary offset of zero means the writer left it unset', () => {
  assert.deepEqual(fetchFor(0n), [{ startByte: 40, endByte: 140 }])
})

test('a real dictionary offset starts the chunk at the dictionary page', () => {
  assert.deepEqual(fetchFor(4n), [{ startByte: 4, endByte: 104 }])
})
