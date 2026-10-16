import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parquetReadObjects, parquetScan } from '../src/index.js'

const bytes = readFileSync(new URL('../data/dictionary_offset_indexed.parquet', import.meta.url))
const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const filter = { $nor: [{ country: 'Canada' }, { id: { $lt: 5 } }] }
const keep = row => row.country !== 'Canada' && !(row.id < 5n)

test('a $nor filter reads the rows that match none of its branches', async () => {
  const all = await parquetReadObjects({ file })
  const rows = await parquetReadObjects({ file, filter })
  assert.equal(rows.length, 162)
  assert.deepEqual(rows, all.filter(keep))
})

test('a $nor filter on a column outside the projection still reads that column', async () => {
  const all = await parquetReadObjects({ file })
  const rows = await parquetReadObjects({ file, columns: ['id'], filter })
  assert.deepEqual(rows, all.filter(keep).map(row => ({ id: row.id })))
})

test('a scan pruned by a $nor filter can read the columns the filter names', async () => {
  const scan = await parquetScan({ file, columns: ['id'], pruningFilter: filter })
  assert.deepEqual(scan.ranges, [{ rowStart: 0, rowEnd: 200 }])
  const countries = await scan.readColumn({ column: 'country', rowStart: 0, rowEnd: 200 })
  assert.equal(countries.length, 200)
  assert.equal(countries[0], 'Canada')
})
