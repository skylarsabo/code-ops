import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parquetMetadataAsync, parquetQuery, parquetReadObjects, parquetScan } from '../src/index.js'

const bytes = readFileSync(new URL('../data/bloom_filter.parquet', import.meta.url))
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

/** An AsyncBuffer that checks every range, like a ranged read from disk or a server. */
function rangeChecked() {
  return {
    byteLength: buffer.byteLength,
    slice: async (start, end = buffer.byteLength) => {
      if (!(start >= 0) || end > buffer.byteLength || start > end) {
        throw new RangeError(`slice start ${start} is outside the file`)
      }
      return buffer.slice(start, end)
    },
  }
}

test('reading every row through a range-checked source matches the plain buffer', async () => {
  const expected = await parquetReadObjects({ file: buffer })
  assert.equal(expected.length, 4096)
  assert.deepEqual(await parquetReadObjects({ file: rangeChecked() }), expected)
})

test('a filtered query through a range-checked source reads its rows', async () => {
  const rows = await parquetQuery({ file: rangeChecked(), filter: { code: { $eq: 30 } } })
  assert.equal(rows.length, 1024)
})

test('a scan through a range-checked source plans both row groups', async () => {
  const scan = await parquetScan({ file: rangeChecked() })
  assert.deepEqual(scan.ranges, [{ rowStart: 0, rowEnd: 2048 }, { rowStart: 2048, rowEnd: 4096 }])
})

test('reading the footer through a range-checked source returns the row count', async () => {
  const metadata = await parquetMetadataAsync(rangeChecked())
  assert.equal(Number(metadata.num_rows), 4096)
})
