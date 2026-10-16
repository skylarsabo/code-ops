import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parquetPlanGroups } from '../src/plan.js'

const metadata = {
  version: 2,
  schema: [{ name: 'root', num_children: 1 }, { name: 'a', type: 'INT32', repetition_type: 'REQUIRED' }],
  num_rows: 30n,
  row_groups: [{
    columns: [{
      meta_data: { path_in_schema: ['a'], data_page_offset: 4n, total_compressed_size: 100n },
      offset_index_offset: 200n,
      offset_index_length: 16,
    }],
    total_byte_size: 100n,
    num_rows: 30n,
  }],
  metadata_length: 0,
}

// One group of 30 rows in three pages that start at rows 0, 10, and 20.
const pageLocations = [{
  a: [0, 10, 20].map(row => ({ offset: 4n + BigInt(row), compressed_page_size: 10, first_row_index: BigInt(row) })),
}]

/** @param {[number, number][]} pageRanges */
function planned(pageRanges) {
  const { groups } = parquetPlanGroups({ metadata, pageRangesByGroup: [pageRanges], pageLocationsByGroup: pageLocations })
  return groups[0].ranges
}

test('ranges that end and start on a page boundary stay separate', () => {
  assert.deepEqual(planned([[0, 10], [10, 20]]), [[0, 10], [10, 20]])
})

test('ranges that share a page are merged', () => {
  assert.deepEqual(planned([[0, 5], [8, 12]]), [[0, 12]])
})

test('a gap of a whole page keeps ranges separate', () => {
  assert.deepEqual(planned([[0, 10], [20, 30]]), [[0, 10], [20, 30]])
})
