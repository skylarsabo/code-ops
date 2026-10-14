import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parquetPlanGroup } from '../src/plan.js'

/** @param {[string, number][]} chunks name and start byte, each 100 bytes long */
function fetchesFor(chunks) {
  const rowGroup = {
    columns: chunks.map(([name, start]) => ({
      meta_data: { path_in_schema: [name], data_page_offset: BigInt(start), total_compressed_size: 100n },
    })),
    total_byte_size: 0n,
    num_rows: 10n,
  }
  const { fetches } = parquetPlanGroup({
    rowGroup,
    groupStart: 0,
    groupRows: 10,
    ranges: [[0, 10]],
    columns: chunks.map(([name]) => name),
  })
  return fetches
}

test('selected chunks that touch are read as one range', () => {
  assert.deepEqual(fetchesFor([['a', 100], ['b', 200]]), [{ startByte: 100, endByte: 300 }])
})

test('a gap of exactly the gap limit is bridged and a larger gap is not', () => {
  assert.deepEqual(fetchesFor([['a', 100], ['b', 200 + 8192]]), [{ startByte: 100, endByte: 8492 }])
  assert.deepEqual(fetchesFor([['a', 100], ['b', 200 + 8193]]), [{ startByte: 100, endByte: 200 }, { startByte: 8393, endByte: 8493 }])
})

test('chunks given out of file order are still coalesced in order', () => {
  assert.deepEqual(fetchesFor([['b', 200], ['a', 100]]), [{ startByte: 100, endByte: 300 }])
})
