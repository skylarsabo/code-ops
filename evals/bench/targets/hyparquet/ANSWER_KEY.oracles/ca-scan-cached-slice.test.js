import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetScan } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('a sub-range read served from the column cache returns the requested rows', async () => {
  const scan = await parquetScan({ file: load('dictionary_offset_indexed.parquet') })
  const head = Array.from(await scan.readColumn({ column: 'id', rowStart: 0, rowEnd: 100 }))
  assert.equal(head.length, 100)
  const tail = Array.from(await scan.readColumn({ column: 'id', rowStart: 10, rowEnd: 100 }))
  assert.equal(tail.length, 90)
  assert.deepEqual(tail, head.slice(10))
  const middle = Array.from(await scan.readColumn({ column: 'id', rowStart: 20, rowEnd: 30 }))
  assert.deepEqual(middle, head.slice(20, 30))
})
