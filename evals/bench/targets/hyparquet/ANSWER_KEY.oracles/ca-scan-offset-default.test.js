import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects, parquetScan } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('scan column reads agree with a plain read with or without the offset index', async () => {
  const file = load('dictionary_offset_indexed.parquet')
  const rows = await parquetReadObjects({ file })
  const expected = rows.slice(40, 90).map(row => row.country)
  for (const useOffsetIndex of [undefined, true, false]) {
    const scan = await parquetScan({ file, useOffsetIndex })
    const countries = await scan.readColumn({ column: 'country', rowStart: 40, rowEnd: 90 })
    assert.deepEqual(Array.from(countries), expected, `useOffsetIndex ${useOffsetIndex}`)
  }
})
