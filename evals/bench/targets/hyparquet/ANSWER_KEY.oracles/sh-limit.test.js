// Acceptance test for the `limit` option of parquetRead, parquetReadObjects, and parquetQuery.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery, parquetRead, parquetReadObjects, rowIndex } from '../src/index.js'

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
  for (const limit of [-1, 1.5, NaN, -Infinity, '2', null, 2n, true]) {
    await assert.rejects(
      parquetReadObjects({ file, limit: /** @type {any} */ (limit) }),
      Error,
      `limit ${String(limit)} should reject`
    )
  }
  await assert.rejects(readRows({ file, limit: -1 }), Error)
})

/** A file source whose slice returns a promise, like a file behind a network request. */
function asyncFile(/** @type {string} */ name) {
  const buffer = load(name)
  return { byteLength: buffer.byteLength, slice: async (/** @type {number} */ start, /** @type {number | undefined} */ end) => buffer.slice(start, end) }
}

/** Project rows to id and country, which drops the helper keys that some query paths add. */
const plain = (/** @type {any[]} */ rows) => rows.map(({ id, country }) => ({ id, country }))

/** Stable ascending sort by country, as an independent expectation for orderBy. */
const byCountry = (/** @type {any[]} */ rows) => rows
  .map((row, index) => ({ row, index }))
  .sort((a, b) => (a.row.country < b.row.country ? -1 : a.row.country > b.row.country ? 1 : a.index - b.index))
  .map(({ row }) => row)

test('a limit above any row count, such as the largest safe integer, changes nothing', async () => {
  const file = load('datapage_v2.snappy.parquet')
  const all = await parquetReadObjects({ file })
  assert.deepEqual(await parquetReadObjects({ file, limit: Number.MAX_SAFE_INTEGER }), all)
})

test('limit with a filter that matches no row delivers an empty array', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  assert.deepEqual(await parquetReadObjects({ file, filter: { country: 'Atlantis' }, limit: 5 }), [])
})

test('limit does not change the chunks that onChunk receives', async () => {
  const file = load('bloom_filter.parquet')
  /** @param {number | undefined} limit */
  async function chunks(limit) {
    /** @type {string[]} */
    const seen = []
    await parquetRead({
      file,
      limit,
      onChunk: chunk => { seen.push(`${chunk.columnName}:${chunk.rowStart}-${chunk.rowEnd}:${chunk.columnData.length}`) },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    return seen.sort()
  }
  const all = await chunks(undefined)
  assert.ok(all.length >= 2)
  assert.deepEqual(await chunks(1), all)
  assert.deepEqual(await chunks(0), all)
})

test('limit works when the file source returns promises', async () => {
  const file = asyncFile('dictionary_offset_indexed.parquet')
  const rows = await parquetReadObjects({ file, filter: { country: 'France' }, limit: 2 })
  assert.deepEqual(rows.map(row => row.id), [4n, 5n])
  assert.equal((await parquetReadObjects({ file, limit: 7 })).length, 7)
  assert.equal((await parquetQuery({ file, orderBy: 'country', limit: 3 })).length, 3)
})

test('parquetQuery limit keeps the first rows of the unlimited result', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetQuery({ file })
  assert.equal(all.length, 200)
  assert.deepEqual(await parquetQuery({ file, limit: 7 }), all.slice(0, 7))
  assert.deepEqual(await parquetQuery({ file, limit: 1000 }), all)
  assert.deepEqual(await parquetQuery({ file, limit: Infinity }), all)
  assert.deepEqual(await parquetQuery({ file, limit: undefined }), all)
})

test('parquetQuery limit counts rows after sorting', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const sorted = byCountry(all)
  assert.notDeepEqual(sorted.slice(0, 5), all.slice(0, 5))
  const rows = await parquetQuery({ file, orderBy: 'country', limit: 5 })
  assert.deepEqual(plain(rows), sorted.slice(0, 5))
  const bigger = await parquetQuery({ file, orderBy: 'country', limit: 60 })
  assert.deepEqual(plain(bigger), sorted.slice(0, 60))
})

test('parquetQuery limit counts rows after filtering and sorting', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const filter = { $or: [{ country: 'France' }, { country: 'Japan' }] }
  const matches = byCountry(all.filter(row => row.country === 'France' || row.country === 'Japan'))
  assert.ok(matches.length > 40)
  const rows = await parquetQuery({ file, filter, orderBy: 'country', limit: 40 })
  assert.deepEqual(plain(rows), matches.slice(0, 40))
  const projected = await parquetQuery({ file, filter, orderBy: 'country', columns: ['id'], limit: 3 })
  assert.deepEqual(projected, matches.slice(0, 3).map(row => ({ id: row.id })))
})

test('parquetQuery rowStart and rowEnd apply before limit', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const all = await parquetReadObjects({ file })
  const sorted = byCountry(all)
  const france = all.filter(row => row.country === 'France')
  assert.deepEqual(plain(await parquetQuery({ file, orderBy: 'country', rowStart: 10, rowEnd: 50, limit: 5 })), sorted.slice(10, 15))
  assert.deepEqual(plain(await parquetQuery({ file, orderBy: 'country', rowStart: 10, rowEnd: 13, limit: 50 })), sorted.slice(10, 13))
  assert.deepEqual(await parquetQuery({ file, filter: { country: 'France' }, rowStart: 3, rowEnd: 20, limit: 4 }), france.slice(3, 7))
  assert.deepEqual(await parquetQuery({ file, filter: { country: 'France' }, rowStart: 2, limit: 4 }), france.slice(2, 6))
  assert.deepEqual(await parquetQuery({ file, rowStart: 20, rowEnd: 40, limit: 3 }), all.slice(20, 23))
})

test('parquetQuery limit with a filter spans row groups', async () => {
  const file = load('bloom_filter.parquet')
  const all = await parquetReadObjects({ file })
  const matches = all.filter(row => row.code === 30)
  assert.ok(matches.length > 12)
  assert.deepEqual(await parquetQuery({ file, filter: { code: 30 }, limit: 12 }), matches.slice(0, 12))
  assert.deepEqual(await parquetQuery({ file, filter: { code: 30 }, rowEnd: 20, limit: 5 }), matches.slice(0, 5))
  const sorted = await parquetQuery({ file, orderBy: 'code', limit: 2050 })
  assert.equal(sorted.length, 2050)
  assert.ok(sorted.every((row, i) => i === 0 || sorted[i - 1].code <= row.code))
})

test('parquetQuery limit 0 returns an empty array and an invalid limit rejects', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  assert.deepEqual(await parquetQuery({ file, limit: 0 }), [])
  assert.deepEqual(await parquetQuery({ file, orderBy: 'country', limit: 0 }), [])
  assert.deepEqual(await parquetQuery({ file, filter: { country: 'France' }, limit: 0 }), [])
  for (const limit of [-1, 2.5, NaN, '3', null]) {
    for (const extra of [{}, { orderBy: 'country' }, { filter: { country: 'France' } }]) {
      await assert.rejects(
        parquetQuery({ file, ...extra, limit: /** @type {any} */ (limit) }),
        Error,
        `limit ${String(limit)} should reject`
      )
    }
  }
})

test('parquetQuery limit keeps the physical row index', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const sorted = await parquetQuery({ file, orderBy: 'country', limit: 4, includeRowIndex: true })
  assert.equal(sorted.length, 4)
  assert.deepEqual(sorted.map(row => row[rowIndex]), sorted.map(row => Number(row.id) - 1))
  const filtered = await parquetQuery({
    file, filter: { country: 'France' }, orderBy: 'id', rowStart: 1, limit: 3, includeRowIndex: true,
  })
  assert.deepEqual(filtered.map(row => row.id), [5n, 13n, 14n])
  assert.deepEqual(filtered.map(row => row[rowIndex]), [4, 12, 13])
})
