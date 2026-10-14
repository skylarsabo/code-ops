import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata } from '../src/index.js'
import { readOffsetIndex } from '../src/indexes.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// dictionary_offset_indexed.parquet has 200 rows and an offset index on each column.

test('an offset index lists pages by first row, in file order', () => {
  const file = load('dictionary_offset_indexed.parquet')
  for (const chunk of parquetMetadata(file).row_groups[0].columns) {
    assert.ok(chunk.offset_index_offset && chunk.offset_index_length)
    const start = Number(chunk.offset_index_offset)
    const buffer = file.slice(start, start + chunk.offset_index_length)
    const pages = readOffsetIndex({ view: new DataView(buffer), offset: 0 }).page_locations
    assert.ok(pages.length > 0)
    assert.equal(Number(pages[0].first_row_index), 0)
    for (let i = 0; i < pages.length; i++) {
      assert.ok(Number(pages[i].first_row_index) < 200)
      assert.ok(pages[i].compressed_page_size > 0)
      if (i > 0) {
        assert.ok(Number(pages[i].first_row_index) > Number(pages[i - 1].first_row_index))
        assert.ok(Number(pages[i].offset) >= Number(pages[i - 1].offset) + pages[i - 1].compressed_page_size)
      }
    }
  }
})
