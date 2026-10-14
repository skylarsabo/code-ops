// Acceptance test for the `limit` read option.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetRead, parquetReadObjects, rowIndex } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** @param {any} options */
function readRows(options) {
  return new Promise((onComplete, reject) => {
    parquetRead({ ...options, onComplete }).catch(reject)
  })
}

test('limit keeps the first rows in file order', async () => {
  const file = load('datapage_v2.snappy.parquet')
  const all = await parquetReadObjects({ file })
  assert.equal(all.length, 5)
  assert.deepEqual(await parquetReadObjects({ file, limit: 3 }), all.slice(0, 3))
  assert.deepEqual(await parquetReadObjects({ file, limit: 1 }), all.slice(0, 1))
})

test('limit 0 delivers an empty array and still calls onComplete once', async () => {
  const file = load('datapage_v2.snappy.parquet')
  let calls = 0
  /** @type {any} */
  let delivered
  await parquetRead({
    file,
    rowFormat: 'object',
    limit: 0,
    onComplete(rows) { calls++; delivered = rows },
  })
  assert.equal(calls, 1)
  assert.deepEqual(delivered, [])
  assert.deepEqual(await parquetReadObjects({ file, limit: 0 }), [])
})

test('a limit at or above the row count changes nothing', async () => {
  const file = load('datapage_v2.snappy.parquet')
  const all = await parquetReadObjects({ file })
  assert.deepEqual(await parquetReadObjects({ file, limit: 5 }), all)
  assert.deepEqual(await parquetReadObjects({ file, limit: 100 }), all)
  assert.deepEqual(await parquetReadObjects({ file, limit: Infinity }), all)
  assert.deepEqual(await parquetReadObjects({ file, limit: undefined }), all)
})

test('limit applies to array rows', async () => {
  const file = load('datapage_v2.snappy.parquet')
  const all = await readRows({ file })
  const limited = await readRows({ file, limit: 2 })
  assert.equal(all.length, 5)
  assert.ok(Array.isArray(limited[0]))
  assert.deepEqual(limited, all.slice(0, 2))
})

test('limit counts rows that pass the filter', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const filter = { country: 'France' }
  const matches = await parquetReadObjects({ file, filter })
  assert.equal(matches.length, 36)
  const limited = await parquetReadObjects({ file, filter, limit: 4 })
  assert.deepEqual(limited.map(row => row.id), [4n, 5n, 13n, 14n])
  assert.ok(limited.every(row => row.country === 'France'))
  assert.deepEqual(await parquetReadObjects({ file, filter, limit: 1000 }), matches)
})

test('limit with a filter and a column selection that excludes the filter column', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const expected = all.filter(row => row.country === 'Japan').slice(0, 3).map(row => ({ id: row.id }))
  assert.equal(expected.length, 3)
  const rows = await parquetReadObjects({ file, columns: ['id'], filter: { country: 'Japan' }, limit: 3 })
  assert.deepEqual(rows, expected)
})

test('limit counts rows inside rowStart and rowEnd', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const ids = async (/** @type {any} */ extra) => (await parquetReadObjects({ file, columns: ['id'], ...extra })).map(row => row.id)
  assert.deepEqual(await ids({ rowStart: 10, rowEnd: 100, limit: 5 }), [11n, 12n, 13n, 14n, 15n])
  assert.deepEqual(await ids({ rowStart: 195, limit: 100 }), [196n, 197n, 198n, 199n, 200n])
  assert.deepEqual(await ids({ rowStart: 10, rowEnd: 13, limit: 50 }), [11n, 12n, 13n])
  assert.deepEqual(await ids({ rowStart: 10, rowEnd: 13, limit: 0 }), [])
})

test('limit with a filter and rowStart keeps the physical row index', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const rows = await parquetReadObjects({
    file, filter: { country: 'France' }, rowStart: 5, limit: 3, includeRowIndex: true,
  })
  assert.deepEqual(rows.map(row => row.id), [13n, 14n, 16n])
  assert.deepEqual(rows.map(row => row[rowIndex]), [12, 13, 15])
})

test('limit spans row groups', async () => {
  const file = load('bloom_filter.parquet')
  const all = await parquetReadObjects({ file })
  assert.equal(all.length, 4096)
  const rows = await parquetReadObjects({ file, limit: 2050 })
  assert.equal(rows.length, 2050)
  assert.deepEqual(rows, all.slice(0, 2050))
  assert.deepEqual(await parquetReadObjects({ file, rowStart: 2040, limit: 20 }), all.slice(2040, 2060))
  const some = await parquetReadObjects({ file, filter: { code: 30 }, limit: 3 })
  assert.deepEqual(some, [{ code: 30 }, { code: 30 }, { code: 30 }])
})

test('an invalid limit rejects', async () => {
  const file = load('datapage_v2.snappy.parquet')
  for (const limit of [-1, 1.5, NaN, -Infinity, '2']) {
    await assert.rejects(
      parquetReadObjects({ file, limit: /** @type {any} */ (limit) }),
      Error,
      `limit ${String(limit)} should reject`
    )
  }
  await assert.rejects(readRows({ file, limit: -1 }), Error)
})
